/**
 * Recognition Pipeline — Orchestrator
 *
 * Runs the Phase 2 canonical local-OCR path (Tier 1) with an optional
 * upload TTA voting stage for File inputs, falling back to Claude Haiku
 * (Tier 2) when neither can clear the confidence floor.
 *
 * The pipeline has two active tiers post-Phase-2.5:
 *   - Tier 1: local PaddleOCR (canonical + optional upload TTA)
 *   - Tier 2: Claude Haiku fallback (the DB string is still 'tier3_claude'
 *     for telemetry continuity with the original 3-tier design)
 *
 * The legacy pHash hash-cache and Tesseract OCR paths were retired in
 * Session 2.5. `hash_cache` rows written before that session remain in
 * place and continue to serve the AR overlay and the image-harvester;
 * this orchestrator no longer writes to them.
 *
 * Tier functions live in recognition-tiers.ts.
 * Cross-validation logic lives in recognition-validation.ts.
 * Worker management lives in recognition-workers.ts.
 */

import { loadCardDatabase } from './card-db';
import { getSupabase } from './supabase';
import { getCardImageUrl } from '$lib/utils/image-url';
import { addToScanHistory } from '$lib/stores/scan-history.svelte';
import { trackScanMetric } from '$lib/services/error-tracking';
import { reportClientEvent } from '$lib/services/diagnostics-client';
import { userId } from '$lib/stores/auth.svelte';
import { submitReferenceImage } from '$lib/services/reference-images';
import { BOBA_SCAN_CONFIG, BOBA_PIPELINE_CONFIG } from '$lib/data/boba-config';
import type { ScanResult, ScanMethod } from '$lib/types';
import { createThumbnailDataUrl, createListingImageBlob } from './scan-image-utils';
import {
	getImageWorker,
	initWorkers
} from './recognition-workers';
import {
	runTier1,
	runTier2,
	emptyTier2Telemetry,
	type ScanContext,
	type Tier1Telemetry
} from './recognition-tiers';
import { incrementPersona } from './persona';
import {
	getOrOpenActiveSession,
	recordScan as writerRecordScan,
	updateScanOutcome as writerUpdateScanOutcome
} from './scan-writer';
import { cropToCanonical } from './constrained-crop';
import { detectCard, type CardDetection, type CardRect } from './upload-card-detector';
import type { ScanWriteGeometry } from './scan-writer.types';
import { captureScanTelemetry, getBatteryStatus } from './scan-telemetry';
import { parseExifSafe } from '$lib/utils/exif';
import { checkpoint } from './scan-checkpoint';

/**
 * Decision thresholds captured per scan so future analysis can replay
 * how a decision was reached without referring back to source control.
 * Any time these move, bump the values here so the replay is accurate.
 */
function buildDecisionContext() {
	return {
		dhash_max_distance_fuzzy: 5,
		phash_verification_max_distance: 20,
		phash_256_max_distance: 40,
		tier1_min_confidence: 0.8,
		hash_algo_version: 'dhash-krawetz-v1+phash-dct-v2'
	};
}

// Re-export for backward compatibility
export { analyzeFrame, checkImageQuality, computeFrameHash, computeHammingDistance, compositeForFoilMode, resetWorkerFailCount, initWorkers } from './recognition-workers';

/**
 * Shape of the extra telemetry captured inside `recognizeCard()` at
 * shutter-time, handed off to `logScanToSupabaseNew` so we don't repeat
 * the (potentially) expensive EXIF + quality-signal computations.
 */
interface ScanWriteExtras {
	telemetry: ReturnType<typeof captureScanTelemetry>;
	exif: {
		make: string | null;
		model: string | null;
		orientation: number | null;
		captureAt: Date | null;
		software: string | null;
	};
	qualitySignals: {
		blur: number;
		luminanceMean: number;
		luminanceStd: number;
		overexposedPct: number;
		underexposedPct: number;
		edgeDensityCanny: number;
		passed: boolean;
		failReason: string | null;
	} | null;
	photoWidth: number | null;
	photoHeight: number | null;
	captureSource: 'camera_live' | 'camera_upload' | null;
	/** Classifier state at the moment of shutter (Session 1.5). */
	alignmentStateAtCapture: 'no_card' | 'partial' | 'ready' | null;
	/** Viewfinder rect (source-pixel coords) that was used to crop the bitmap. */
	viewfinder: { x: number; y: number; width: number; height: number } | null;
	/** Doc 1, Phase 6: per-capture geometry telemetry from corner detection. */
	geometry: ScanWriteGeometry | null;
}

/**
 * Open the scan row BEFORE any tier runs so each tier_result can FK to it.
 * Returns the scan_id (or null on failure / anonymous user).
 *
 * Replaces the old logScanToSupabaseNew which wrote the scan + a single
 * winning-tier row AFTER the pipeline completed. Now finalize() calls
 * writerUpdateScanOutcome to patch in the winning_tier / final_* fields.
 */
async function openScanRow(
	bitmap: ImageBitmap,
	sourceImage: File | Blob | ImageBitmap | undefined,
	extras: ScanWriteExtras,
	gameHint: string
): Promise<string | null> {
	const uid = userId();
	if (!uid) return null;

	// Resolve battery outside of the hot scan path — its first call reads
	// navigator.getBattery() which resolves a Promise on Chrome; cached after.
	const battery = await getBatteryStatus().catch(() => ({ level: null, charging: null }));

	const sessionGameId = gameHint || 'boba';
	const sessionId = await getOrOpenActiveSession({
		gameId: sessionGameId,
		netEffectiveType: extras.telemetry.netEffectiveType ?? null,
		netDownlinkMbps: extras.telemetry.netDownlinkMbps ?? null,
		netRttMs: extras.telemetry.netRttMs ?? null,
		isPwaStandalone: extras.telemetry.isPwaStandalone ?? null,
		pageSessionAgeMs: extras.telemetry.pageSessionAgeMs ?? null,
		batteryLevel: battery.level,
		batteryCharging: battery.charging
	});
	if (!sessionId) return null;

	// Convert ImageBitmap to Blob if necessary. File and Blob pass through.
	// When no sourceImage was provided, fall back to the bitmap so we still
	// get a photo uploaded for diagnostics.
	const photoBlob = await normalizeToBlob(sourceImage ?? bitmap);

	const photoMimeType = sourceImage instanceof Blob ? sourceImage.type || null : null;
	const photoBytes = sourceImage instanceof Blob ? sourceImage.size : null;

	const scanId = await writerRecordScan({
		sessionId,
		gameId: sessionGameId,
		captureLatencyMs: null,
		photoBlob,

		// Session 1.5 capture-context: viewfinder-alignment telemetry. Stored
		// in capture_context JSONB so Tier 1 hit rate can be segmented by
		// alignment quality at the moment of shutter.
		captureContext: {
			alignment_state_at_capture: extras.alignmentStateAtCapture,
			viewfinder_x: extras.viewfinder?.x ?? null,
			viewfinder_y: extras.viewfinder?.y ?? null,
			viewfinder_width: extras.viewfinder?.width ?? null,
			viewfinder_height: extras.viewfinder?.height ?? null
		},

		// Capture source identity
		captureSource: extras.captureSource ?? null,
		photoMimeType,
		photoBytes,
		photoWidth: extras.photoWidth ?? null,
		photoHeight: extras.photoHeight ?? null,

		// EXIF subset (GPS never captured)
		exifMake: extras.exif.make ?? null,
		exifModel: extras.exif.model ?? null,
		exifOrientation: extras.exif.orientation ?? null,
		exifCaptureAt: extras.exif.captureAt ?? null,
		exifSoftware: extras.exif.software ?? null,

		// Device state at shutter
		deviceOrientationBeta: extras.telemetry.deviceOrientationBeta ?? null,
		deviceOrientationGamma: extras.telemetry.deviceOrientationGamma ?? null,
		accelMagnitude: extras.telemetry.accelMagnitude ?? null,

		// Image quality signals
		blurLaplacianVariance: extras.qualitySignals?.blur ?? null,
		luminanceMean: extras.qualitySignals?.luminanceMean ?? null,
		luminanceStd: extras.qualitySignals?.luminanceStd ?? null,
		overexposedPct: extras.qualitySignals?.overexposedPct ?? null,
		underexposedPct: extras.qualitySignals?.underexposedPct ?? null,
		edgeDensityCanny: extras.qualitySignals?.edgeDensityCanny ?? null,
		qualityGatePassed: extras.qualitySignals?.passed ?? null,
		qualityGateFailReason: extras.qualitySignals?.failReason ?? null,

		// Decision context (replay / counterfactual)
		decisionContext: buildDecisionContext(),

		// Doc 1, Phase 6: per-capture geometry telemetry
		geometry: extras.geometry
	});
	return scanId;
}

/**
 * Map the winning ScanResult back to a `winning_tier` string for the
 * scans.winning_tier column. `winningTier` on the result takes precedence
 * when set — used by the canonical PaddleOCR path (tier1_local_ocr) and
 * the upload-TTA fallback (tier1_upload_tta, Session 2.1b) so analytics
 * can separate them from the legacy hash_cache tier.
 */
function winningTierFromResult(result: ScanResult): string {
	if (result.winningTier) return result.winningTier;
	switch (result.scan_method) {
		case 'local_ocr': return 'tier1_local_ocr';
		case 'upload_tta': return 'tier1_upload_tta';
		// 'tier3_claude' is the legacy DB string for the Claude Haiku fallback,
		// which is conceptually Tier 2 in the post-Phase-2.5 two-tier pipeline.
		// We keep the literal value for telemetry continuity with historical
		// scan rows.
		case 'claude': return 'tier3_claude';
		case 'manual':
		// 'hash_cache' and 'tesseract' were retired in 2.5; their cases
		// are kept in the type union for ScanResult backward compat but
		// can no longer be produced by the live pipeline.
		case 'hash_cache':
		case 'tesseract':
		default: return 'manual';
	}
}

/**
 * Patch a `scans` row with a non-success outcome and let the user move on.
 * Fire-and-forget, swallows errors (telemetry must never break a scan).
 *
 * Used by every early-return failure path before finalize() is reached:
 *   - blur reject (low_quality_rejected)
 *   - card database empty (abandoned)
 *   - bitmap invalid (abandoned)
 *   - offline queue (abandoned)
 *   - all-tiers no match (resolved with null final_card_id — keeps the
 *     "AI couldn't identify" cohort separate from infra abandonments)
 */
function patchAbandonedScan(
	scanIdPromise: Promise<string | null>,
	outcome: import('./scan-writer').ScanOutcome,
	startTime: number,
	failReason: string | null
): void {
	void scanIdPromise.then((scanId) => {
		if (!scanId) return;
		void writerUpdateScanOutcome({
			scanId,
			winningTier: null,
			finalCardId: null,
			finalConfidence: null,
			finalParallel: null,
			totalLatencyMs: Math.round(performance.now() - startTime),
			totalCostUsd: null,
			outcome,
			decisionContext: failReason ? { abandon_reason: failReason } : null
		});
	}).catch(() => { /* swallow */ });
}

/**
 * Clone an ImageBitmap by drawing it to an OffscreenCanvas and transferring
 * back out. Used at the Comlink boundary so main-thread bitmap ownership
 * survives regardless of Comlink's auto-transfer semantics for ImageBitmap.
 */
async function cloneImageBitmap(src: ImageBitmap): Promise<ImageBitmap> {
	const canvas = new OffscreenCanvas(src.width, src.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('no 2d ctx');
	ctx.drawImage(src, 0, 0);
	return canvas.transferToImageBitmap();
}

/**
 * Probe an ImageBitmap for validity. A bitmap whose ownership was transferred
 * to a worker (or has been closed) throws InvalidStateError on width access
 * or reports 0×0 dimensions.
 */
function isBitmapValid(bmp: ImageBitmap): { valid: boolean; reason: string | null } {
	try {
		const w = bmp.width;
		const h = bmp.height;
		if (!(w > 0 && h > 0)) return { valid: false, reason: `zero-size ${w}x${h}` };
		return { valid: true, reason: null };
	} catch (err) {
		return { valid: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * @param imageSource - File, Blob, or ImageBitmap to scan
 * @param onTierChange - Optional callback for UI progress updates
 * @returns ScanResult with matched card data
 */
export async function recognizeCard(
	imageSource: File | Blob | ImageBitmap,
	onTierChange?: (tier: 1 | 2) => void,
	options?: {
		isAuthenticated?: boolean;
		skipBlurCheck?: boolean;
		cropRegion?: { x: number; y: number; width: number; height: number } | null;
		gameHint?: string | null;
		alignmentStateAtCapture?: 'no_card' | 'partial' | 'ready' | null;
		viewfinder?: { x: number; y: number; width: number; height: number } | null;
		/** Session 2.1a: pre-shutter live-OCR consensus, used as a hint by the
		 *  local PaddleOCR Tier 1 path. */
		liveConsensusSnapshot?:
			| import('./live-ocr-coordinator').LiveOCRSnapshot
			| null;
		/** Doc 1, Phase 6: caller-supplied geometry from live-mode corner
		 *  detection. Upload mode runs detectCard inside this function and
		 *  ignores any caller-supplied geometry. */
		geometry?: ScanWriteGeometry | null;
	}
): Promise<ScanResult> {
	const traceId = crypto.randomUUID().slice(0, 8);
	const startTime = performance.now();
	checkpoint(traceId, 'recognize:start', 0, {
		capture_source:
			imageSource instanceof File
				? 'upload'
				: imageSource instanceof ImageBitmap
					? 'live_bitmap'
					: 'live_blob'
	});
	await initWorkers();
	checkpoint(traceId, 'initWorkers:done', performance.now() - startTime);

	// Resolve game context:
	//   - Explicit gameHint ('boba' | 'wonders') → single-game mode (backward compat)
	//   - null/undefined                        → auto-detect (load all games)
	const gameHintRaw = options?.gameHint;
	const isAutoDetect = gameHintRaw === null || gameHintRaw === undefined;
	const gameHint = isAutoDetect ? '' : (gameHintRaw as string);
	const gamesToLoad: string | readonly string[] = isAutoDetect
		? ['boba', 'wonders']
		: gameHint;

	const loadedCards = await loadCardDatabase(gamesToLoad);

	// Guard: if card database is empty, don't waste API calls on Tier 2.
	// NOTE: this fires BEFORE openScanRow so there's no scan row to patch —
	// the abandonment is implicit (no row was ever inserted).
	if (loadedCards.length === 0) {
		console.warn(`[scan:${traceId}] Card database empty — aborting pipeline`);
		return {
			card_id: null,
			card: null,
			scan_method: 'manual' as ScanMethod,
			confidence: 0,
			processing_ms: Math.round(performance.now() - startTime),
			failReason: 'Card database unavailable — please check your connection and try again'
		};
	}

	console.debug(`[scan:${traceId}] Pipeline started. ${loadedCards.length} cards loaded (games=${isAutoDetect ? 'auto' : gameHint}).`);

	// Per-scan context to avoid global state pollution across concurrent scans
	const ctx: ScanContext = { traceId, lastTier2FailReason: null, cropRegion: options?.cropRegion ?? null, gameHint };

	// Convert to ImageBitmap for worker transfer
	const ownsBitmap = !(imageSource instanceof ImageBitmap);
	const bitmap =
		imageSource instanceof ImageBitmap
			? imageSource
			: await createImageBitmap(imageSource);

	// ── Shutter-time telemetry capture ─────────────────────
	// All of this is best-effort. Any failure here MUST NOT break a scan.
	// Runs alongside the existing blur check, so we pay no extra latency.
	const shutterTelemetry = captureScanTelemetry();
	const captureSource: 'camera_live' | 'camera_upload' | null =
		imageSource instanceof File
			? 'camera_upload'
			: imageSource instanceof Blob || imageSource instanceof ImageBitmap
				? 'camera_live'
				: null;

	// EXIF read only makes sense for uploads (live camera frames have no EXIF).
	let shutterExif: Awaited<ReturnType<typeof parseExifSafe>> = {
		make: null,
		model: null,
		orientation: null,
		captureAt: null,
		software: null
	};
	if (imageSource instanceof Blob) {
		try {
			shutterExif = await parseExifSafe(imageSource);
		} catch {
			// swallow
		}
	}

	// Image quality signals — piggybacks the existing blur check worker.
	let shutterQuality: Awaited<
		ReturnType<ReturnType<typeof getImageWorker>['computeQualitySignals']>
	> | null = null;
	checkpoint(traceId, 'quality_signals:start', performance.now() - startTime);
	try {
		// Pass a clone so Comlink transfer doesn't detach the main-thread bitmap.
		const qsClone = await cloneImageBitmap(bitmap);
		shutterQuality = await getImageWorker().computeQualitySignals(qsClone);
		checkpoint(traceId, 'quality_signals:done', performance.now() - startTime, {
			blur: shutterQuality?.blur ?? null,
			passed: shutterQuality?.passed ?? null
		});
	} catch (err) {
		checkpoint(traceId, 'quality_signals:threw', performance.now() - startTime, {
			error: err instanceof Error ? err.message : String(err)
		});
		console.debug('[scan] computeQualitySignals failed, continuing:', err);
	}

	// Session 1.5: live captures are already cropped to the viewfinder rect by
	// Scanner.svelte before scanImage. Uploads are NOT — they arrive as raw
	// phone photos with the card embedded somewhere. For Files, run edge
	// detection to find the card rectangle and produce an equivalent
	// 1500×2100 cropped frame. Without this, region-based OCR lands on photo
	// coordinates (background, hands, margins) instead of card coordinates
	// and the upload path can never hit Tier 1.
	let workingBitmap: ImageBitmap = bitmap;
	let croppedBitmapOwned: ImageBitmap | null = null;
	let detectedCardRect: CardRect | null = null;
	let detectedCardDetection: CardDetection | null = null;
	if (imageSource instanceof File) {
		try {
			checkpoint(traceId, 'card_detect:start', performance.now() - startTime);
			const detection = await detectCard(bitmap, { mode: 'upload' });
			detectedCardDetection = detection;
			detectedCardRect = {
				x: detection.boundingRect.x,
				y: detection.boundingRect.y,
				width: detection.boundingRect.width,
				height: detection.boundingRect.height,
				method:
					detection.method === 'corner_detected'
						? 'corner_detected'
						: 'centered_fallback'
			};
			const cropped = await cropToCanonical(
				bitmap,
				detectedCardRect,
				detection.homography
			);
			croppedBitmapOwned = cropped;
			workingBitmap = cropped;
			checkpoint(traceId, 'card_detect:done', performance.now() - startTime, {
				method: detectedCardRect.method,
				x: detectedCardRect.x,
				y: detectedCardRect.y,
				width: detectedCardRect.width,
				height: detectedCardRect.height,
				rectification_applied: !!detection.homography,
				px_per_mm: detection.pxPerMm,
				aspect_ratio: detection.aspectRatio
			});
		} catch (err) {
			checkpoint(traceId, 'card_detect:threw', performance.now() - startTime, {
				error: err instanceof Error ? err.message : String(err)
			});
			console.warn('[scan] card-rect detection failed, using full photo:', err);
			// workingBitmap stays = bitmap; pipeline continues with the
			// uncropped photo (matches pre-fix behavior — graceful degrade).
		}
	}

	// CRITICAL: check the bitmap is still valid BEFORE passing it to tiers.
	// If a prior worker call transferred ownership, it's closed and subsequent
	// worker calls hang. Verify explicitly so we catch a regression instead.
	checkpoint(traceId, 'bitmap:validity_check:start', performance.now() - startTime);
	const wbValidity = isBitmapValid(workingBitmap);
	checkpoint(traceId, 'bitmap:validity_check:done', performance.now() - startTime, {
		valid: wbValidity.valid,
		width: wbValidity.valid ? workingBitmap.width : null,
		reason: wbValidity.reason
	});
	if (!wbValidity.valid) {
		checkpoint(traceId, 'bitmap:INVALID', performance.now() - startTime, {
			reason: wbValidity.reason
		});
		if (ownsBitmap) {
			try { bitmap.close(); } catch { /* ignore */ }
		}
		if (croppedBitmapOwned) {
			try { croppedBitmapOwned.close(); } catch { /* ignore */ }
		}
		// Bitmap invalid runs BEFORE openScanRow so there's no row to patch.
		return {
			card_id: null,
			card: null,
			scan_method: 'manual' as ScanMethod,
			confidence: 0,
			processing_ms: Math.round(performance.now() - startTime),
			failReason: 'Image buffer was lost during processing — please try again'
		};
	}

	// Doc 1, Phase 6: geometry telemetry. Upload mode just ran detectCard
	// above; live mode passes the detection through `options.geometry`.
	const resolvedGeometry: ScanWriteGeometry | null = detectedCardDetection
		? {
				detection_method: detectedCardDetection.method,
				px_per_mm_at_capture: detectedCardDetection.pxPerMm,
				aspect_ratio_at_capture: detectedCardDetection.aspectRatio,
				rectification_applied: !!detectedCardDetection.homography,
				canonical_size: '750x1050',
				detected_corners: detectedCardDetection.corners
			}
		: (options?.geometry ?? null);

	const scanWriteExtras: ScanWriteExtras = {
		telemetry: shutterTelemetry,
		exif: shutterExif,
		qualitySignals: shutterQuality,
		photoWidth: bitmap.width,
		photoHeight: bitmap.height,
		captureSource,
		alignmentStateAtCapture: options?.alignmentStateAtCapture ?? null,
		viewfinder: options?.viewfinder ?? null,
		geometry: resolvedGeometry
	};

	// ── Open scan row EARLY so tier_results can FK to it ────
	// scanIdPromise runs in parallel with tier execution; tier2-claude and
	// recognition-tiers both tolerate a null resolution (unauthenticated
	// scan, or openScanRow failure). Flag gating removed in session 2.10 —
	// unified on the single scan-writer path.
	const scanIdPromise: Promise<string | null> = userId()
		? openScanRow(bitmap, imageSource, scanWriteExtras, gameHint)
			.catch((err) => {
				console.debug(`[scan:${traceId}] openScanRow failed:`, err);
				reportClientEvent({
					level: 'warn',
					event: 'scan.recognition.openScanRow_threw',
					error: err,
					context: { traceId, captureSource }
				});
				return null;
			})
		: (() => {
				// Capture this. When userId() is null, the entire scan-writer
				// path silently skips. Tier 2 still fires because /api/scan is
				// auth-optional, but no scan_sessions/scans/tier_results rows
				// land in the DB. This event surfaces the silent loss.
				reportClientEvent({
					level: 'warn',
					event: 'scan.recognition.unauth_scan_skipped',
					context: { traceId, captureSource }
				});
				return Promise.resolve(null);
			})();

	// ── Check blur (skip if caller already verified quality) ─
	if (!options?.skipBlurCheck) {
		const blurResult = await getImageWorker().checkBlurry(bitmap, BOBA_SCAN_CONFIG.blurThreshold);
		console.debug(`[scan] Blur check: variance=${blurResult.variance.toFixed(1)}, threshold=${BOBA_SCAN_CONFIG.blurThreshold}, isBlurry=${blurResult.isBlurry}`);
		if (blurResult.isBlurry) {
			console.warn(`[scan] Image rejected as blurry (variance ${blurResult.variance.toFixed(1)} < ${BOBA_SCAN_CONFIG.blurThreshold})`);
			patchAbandonedScan(scanIdPromise, 'low_quality_rejected', startTime,
				`blur_variance=${blurResult.variance.toFixed(1)}`);
			if (ownsBitmap) bitmap.close();
			if (croppedBitmapOwned) {
				try { croppedBitmapOwned.close(); } catch { /* ignore */ }
			}
			return {
				card_id: null,
				card: null,
				scan_method: 'manual',
				confidence: 0,
				processing_ms: Math.round(performance.now() - startTime),
				failReason: 'Image too blurry — try holding the card steady with better lighting'
			};
		}
	}

	// Declared here (not at each tier's run site) so finalize() can close over
	// it on every exit path — including offline returns that happen before
	// Tier 2 would otherwise be declared.
	const tier2Tel = emptyTier2Telemetry();

	// Card-detection telemetry — surfaces in scans.decision_context so we
	// can measure detection hit rate vs centered_fallback rate post-deploy
	// and track Tier 1 hit rate as a function of detection method.
	const cardDetectContext: Record<string, unknown> | null = detectedCardRect
		? {
			method: detectedCardRect.method,
			rect: {
				x: detectedCardRect.x,
				y: detectedCardRect.y,
				width: detectedCardRect.width,
				height: detectedCardRect.height
			},
			source_dimensions: { width: bitmap.width, height: bitmap.height }
		}
		: null;

	// Helper to record scan result to history and auto-tag before returning
	async function finalize(result: ScanResult): Promise<ScanResult> {
		// Prefer the card's own game_id, then the result's tier-set game_id,
		// then the caller's hint, and finally 'boba' for legacy rows without game_id.
		const resolvedGameId = result.card?.game_id
			|| result.game_id
			|| (gameHint || null)
			|| 'boba';
		const final = { ...result, processing_ms: Math.round(performance.now() - startTime), traceId, game_id: result.card ? resolvedGameId : null };
		// Await the scan-row INSERT so consumers (sell flow, listing creator)
		// receive a result whose `id` is already populated. The INSERT was
		// kicked off in parallel with tier work, so by the time we reach
		// finalize() it has had multiple seconds to complete — the await is
		// usually a no-op. Failure is non-fatal: leave id undefined.
		try {
			const resolvedScanId = await scanIdPromise;
			if (resolvedScanId) final.id = resolvedScanId;
		} catch {
			// scanIdPromise already swallows; double-guard for type safety.
		}
		const thumbnail = bitmap instanceof ImageBitmap ? createThumbnailDataUrl(bitmap) : null;

		// Create a listing-quality image blob for Supabase Storage upload.
		// This runs async but we attach the promise to the result so callers can await it.
		if (bitmap instanceof ImageBitmap && final.card_id) {
			final._listingImagePromise = createListingImageBlob(bitmap, ctx.cropRegion ?? null);
		}
		// Explicit string assertion — both branches are string-typed, but
		// being explicit makes future regressions visible in PR diffs.
		const historyImageUrl: string | null =
			(typeof thumbnail === 'string' ? thumbnail : null) ??
			(final.card ? getCardImageUrl(final.card) : null);
		addToScanHistory({
			cardNumber: final.card?.card_number ?? null,
			heroName: final.card?.hero_name ?? null,
			imageUrl: historyImageUrl,
			cardId: final.card?.id ?? null,
			method: final.scan_method || 'unknown',
			confidence: final.confidence,
			success: final.card_id !== null,
			processingMs: final.processing_ms
		});

		// Persist to Supabase for cross-device consistency (non-blocking).
		// Single unified path through scan-writer — legacy dual-write and
		// its telemetry helpers removed in session 2.10.
		if (final.card_id) {
			// Fire the persona increment for every logged-in scan with a card_id,
			// independent of whether the scan row INSERT succeeded. Mirrors the
			// pre-2.10 legacy-path guarantee.
			const client = getSupabase();
			if (client) incrementPersona(client, 'collector');

			// `final.id` was awaited at the top of finalize(); skip the outcome
			// update if the scan-row INSERT failed.
			if (final.id) {
				const scanId = final.id;
				// Sum per-tier costs into total_cost_usd. Tier 1 (local OCR) is
				// free. Tier 2 (Claude Haiku) cost duplicates the per-row calc
				// in emitTier2Result — fine for now; fold into a shared helper
				// in the AI Gateway session.
				const tier2CostUsd =
					tier2Tel.llmInputTokens !== null && tier2Tel.llmOutputTokens !== null
						? (tier2Tel.llmInputTokens * 1.0 + tier2Tel.llmOutputTokens * 5.0) / 1_000_000
						: 0;
				const totalCostUsd = tier2CostUsd > 0 ? tier2CostUsd : null;
				const mergedDecisionCtx = final.decisionContext
					? { ...buildDecisionContext(), ...final.decisionContext }
					: null;

				void writerUpdateScanOutcome({
					scanId,
					winningTier: winningTierFromResult(final),
					// string; Postgres casts to uuid. Assumes recognize-card
					// returns a valid UUID (validated upstream).
					finalCardId: final.card_id!,
					finalConfidence: final.confidence ?? null,
					// final_parallel mirrors cards.parallel — the source of truth.
					// Falls back to the result's parallel field, then null.
					finalParallel: final.card?.parallel ?? final.parallel ?? null,
					totalLatencyMs: final.processing_ms ?? null,
					totalCostUsd,
					// Default success outcome. ScanConfirmation patches to
					// 'user_corrected' if the user overrides the match;
					// 'auto_confirmed' if a high-confidence Tier 1 win is
					// committed without user action.
					outcome: 'resolved',
					liveConsensusReached: final.liveConsensusReached ?? null,
					liveVsCanonicalAgreed: final.liveVsCanonicalAgreed ?? null,
					fallbackTierUsed: final.fallbackTierUsed ?? null,
					decisionContext: mergedDecisionCtx,
					// The initial INSERT defaulted game_id to 'boba' (auto-detect
					// scans don't know the game until matching completes). Patch
					// to the resolved value so a Wonders match doesn't keep
					// claiming game_id='boba'.
					gameId: resolvedGameId
				});
			}
		}

		// Track scan performance metrics for operational monitoring
		trackScanMetric({
			tier: final.scan_method || 'unknown',
			success: final.card_id !== null,
			confidence: Math.round(final.confidence * 100),
			ms: final.processing_ms,
			cardNumber: final.card?.card_number ?? null,
			negativeCacheHit: final.failReason?.includes('not yet in database') ?? false,
			// Phase 2.5: parallel diagnostics so we can audit misidentifications.
			// `user_confirmed_parallel` is recorded separately at collection-add time
			// (see addToCollection) because that's where the user's final choice lives.
			game_id: final.game_id ?? null,
			detected_parallel: final.parallel ?? null,
			parallel_confidence: final.parallel_confidence ?? null,
			collector_number_confidence: final.collector_number_confidence ?? null,
			first_edition_stamp_detected: final.first_edition_stamp_detected ?? false
		});

		// Reference image competition — auto-submit high-confidence scans as
		// candidate reference images. Moved here from the deleted
		// writeHashToAllLayers. Server-side RPC handles "beat the champion"
		// atomic logic. Bitmap work happens synchronously so the network
		// upload can be fire-and-forget without racing the bitmap close.
		if (
			final.card_id &&
			bitmap instanceof ImageBitmap &&
			final.confidence >= BOBA_PIPELINE_CONFIG.referenceImageMinConfidence
		) {
			void (async () => {
				try {
					const worker = getImageWorker();
					const uploadBlob = await worker.resizeForUpload(bitmap, 800);
					const { variance: blurVariance } = await worker.checkBlurry(bitmap, 100);
					if (blurVariance > BOBA_PIPELINE_CONFIG.referenceImageMinVariance) {
						submitReferenceImage(final.card_id!, final.confidence, uploadBlob, blurVariance)
							.catch((err) => {
								console.debug('[scan] Reference image submission failed:', err);
								reportClientEvent({
									level: 'warn',
									event: 'recognition.reference_image_submit_failed',
									error: err,
									context: { card_id: final.card_id }
								});
							});
					}
				} catch (err) {
					console.debug('[scan] Reference image preparation failed:', err);
				}
			})();
		}

		// Auto-tag card with its parallel name
		if (final.card?.parallel && final.card_id) {
			import('$lib/stores/tags.svelte').then(({ addTag }) => {
				addTag(final.card_id!, final.card!.parallel!);
			}).catch((err) => {
				console.debug('[scan] Auto-tag failed:', err);
				reportClientEvent({
					level: 'warn',
					event: 'recognition.auto_tag_failed',
					error: err,
					context: { card_id: final.card_id, parallel: final.card?.parallel }
				});
			});
		}

		return final;
	}

	// ── Offline handling: queue for later if no network ──────
	if (!navigator.onLine) {
		try {
			const { scanQueue } = await import('./idb');
			const imageBlob = imageSource instanceof Blob
				? imageSource
				: await getImageWorker().resizeForUpload(bitmap, 1024);
			await scanQueue.add(imageBlob);
		} catch (err) {
			console.warn(`[scan:${traceId}] Offline queue failed — scan will be lost:`, err);
		}
		patchAbandonedScan(scanIdPromise, 'abandoned', startTime, 'offline_queued');
		return finalize({
			card_id: null,
			card: null,
			scan_method: 'manual' as ScanMethod,
			confidence: 0,
			processing_ms: Math.round(performance.now() - startTime),
			failReason: 'Offline — scan queued for when you reconnect'
		});
	}

	// ── TIER 1: canonical PaddleOCR + optional upload TTA ──
	// Gated by live_ocr_tier1_v1; when off, scans fall straight through to Haiku.
	const liveOCREnabled = await isLiveOCRTier1Enabled();
	const liveConsensusReached = !!options?.liveConsensusSnapshot?.consensus?.reachedThreshold;
	let tier1Telemetry: Tier1Telemetry = {
		canonical: null,
		tta: null,
		canonicalAttempts: []
	};

	if (liveOCREnabled) {
		onTierChange?.(1);
		const ttaEnabled = imageSource instanceof File ? await isUploadTtaEnabled() : false;
		const tier1Outcome = await runTier1({
			workingBitmap,
			ctx,
			imageSource,
			traceId,
			startTime,
			gameHint,
			isAutoDetect,
			liveConsensusSnapshot: options?.liveConsensusSnapshot ?? null,
			liveConsensusReached,
			cardDetectContext,
			confidenceFloor: 0.6,
			ttaEnabled
		});
		tier1Telemetry = tier1Outcome.telemetry;
		if (tier1Outcome.result) {
			return finalize(tier1Outcome.result);
		}
	}

	// ── TIER 2: Claude API ──────────────────────────────────
	// Anonymous users are allowed — server-side rate limit (5/60s per IP) protects against abuse
	onTierChange?.(2);
	console.debug('[scan] Starting Tier 2: Claude AI identification...');
	checkpoint(traceId, 'tier2:start', performance.now() - startTime);
	let tier2Result: ScanResult | null = null;
	try {
		// No outer race: the fetch to /api/scan is the only network op and it's
		// bounded by the server-side Anthropic client + Vercel function timeout.
		// runTier2 emits its scan_tier_results row inside try/finally now.
		tier2Result = await runTier2(workingBitmap, ctx, tier2Tel, scanIdPromise);
		checkpoint(traceId, 'tier2:done', performance.now() - startTime, {
			hit: tier2Result !== null,
			outcome: tier2Tel.outcome
		});
	} catch (err) {
		checkpoint(traceId, 'tier2:threw', performance.now() - startTime, {
			error: err instanceof Error ? err.message : String(err)
		});
		console.warn('[scan] Tier 2 threw:', err);
	}
	if (tier2Result && liveOCREnabled) {
		// Tag the Haiku-fallback telemetry fields so analytics can split
		// flag-on-and-tier2-rescued vs flag-off runs.
		tier2Result.fallbackTierUsed = 'haiku';
		tier2Result.liveConsensusReached = liveConsensusReached;
		tier2Result.liveVsCanonicalAgreed = null;
		// Preserve what canonical / TTA saw so we can debug which stage
		// would have caught which card. Merged with anything Tier 2 already
		// set on decisionContext.
		if (tier1Telemetry.canonical || tier1Telemetry.tta || cardDetectContext) {
			tier2Result.decisionContext = {
				...(tier2Result.decisionContext ?? {}),
				...(tier1Telemetry.canonical
					? {
						canonical_result: tier1Telemetry.canonical.perTask,
						canonical_ocr_strategy: tier1Telemetry.canonical.ocrStrategy,
						canonical_attempts: tier1Telemetry.canonicalAttempts
					}
					: {}),
				...(tier1Telemetry.tta ? { upload_tta: tier1Telemetry.tta } : {}),
				...(cardDetectContext ? { upload_card_rect: cardDetectContext } : {})
			};
		}
	}
	if (tier2Result) {
		console.debug(`[scan] Tier 2 HIT: card_id=${tier2Result.card_id}, card=${tier2Result.card?.card_number}, confidence=${tier2Result.confidence}, game=${tier2Result.game_id ?? tier2Result.card?.game_id ?? gameHint}, parallel=${tier2Result.parallel}`);
		return finalize(tier2Result);
	}
	console.warn('[scan] Tier 2 MISS: Claude could not identify card (see earlier logs for details)');
	// All tiers exhausted — resolved with null final_card_id. Keeps this
	// cohort separate from infra abandonments in outcomeDistribution.
	patchAbandonedScan(scanIdPromise, 'resolved', startTime,
		ctx.lastTier2FailReason || 'all_tiers_no_match');
	return finalize(
		{ card_id: null, card: null, scan_method: 'claude' as ScanMethod, confidence: 0, processing_ms: Math.round(performance.now() - startTime), failReason: ctx.lastTier2FailReason || 'AI could not identify this card' }
	);
}



/**
 * Coerce any recognition input shape into a Blob suitable for upload.
 * Returns undefined if no source was provided or conversion failed.
 */
async function normalizeToBlob(
	source?: File | Blob | ImageBitmap
): Promise<Blob | undefined> {
	if (!source) return undefined;
	if (source instanceof Blob) return source; // File extends Blob, handled here

	// ImageBitmap path — draw to a canvas and extract.
	try {
		if (typeof OffscreenCanvas !== 'undefined') {
			const canvas = new OffscreenCanvas(source.width, source.height);
			const ctx = canvas.getContext('2d');
			if (!ctx) return undefined;
			ctx.drawImage(source, 0, 0);
			return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
		}

		const canvas = document.createElement('canvas');
		canvas.width = source.width;
		canvas.height = source.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return undefined;
		ctx.drawImage(source, 0, 0);
		return await new Promise<Blob | undefined>(resolve =>
			canvas.toBlob(b => resolve(b ?? undefined), 'image/jpeg', 0.95)
		);
	} catch (err) {
		console.debug('[recognition] normalizeToBlob failed', err);
		return undefined;
	}
}

/**
 * Session 2.1a gate. Returns true when Tier 1 should run the local
 * PaddleOCR canonical path (with live-OCR voting hint). When off, the
 * Claude-Haiku-first behavior is preserved exactly.
 */
async function isLiveOCRTier1Enabled(): Promise<boolean> {
	try {
		const flagsModule = await import('$lib/stores/feature-flags.svelte');
		return flagsModule.featureEnabled('live_ocr_tier1_v1')();
	} catch {
		return false;
	}
}

/**
 * Session 2.1b gate. Returns true when uploaded images whose canonical
 * Tier 1 pass fell below the confidence floor should be retried via
 * test-time augmentation voting before falling through to Haiku.
 * Depends on `live_ocr_tier1_v1` being on — the TTA path reuses the
 * same PaddleOCR + ConsensusBuilder infrastructure.
 */
async function isUploadTtaEnabled(): Promise<boolean> {
	try {
		const flagsModule = await import('$lib/stores/feature-flags.svelte');
		return flagsModule.featureEnabled('upload_tta_v1')();
	} catch {
		return false;
	}
}

