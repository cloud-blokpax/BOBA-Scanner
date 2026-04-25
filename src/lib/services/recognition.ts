/**
 * Recognition Pipeline — Orchestrator
 *
 * Runs the Phase 2 canonical local-OCR path (Tier 1) with an optional
 * upload TTA voting stage for File inputs, falling back to Claude Haiku
 * (Tier 3) when neither can clear the confidence floor.
 *
 * The legacy pHash hash-cache (Tier 1) and Tesseract OCR (Tier 2) paths
 * were retired in Session 2.5. `hash_cache` rows written before that
 * session remain in place and continue to serve the AR overlay and the
 * image-harvester; this orchestrator no longer writes to them.
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
	runTier3,
	emptyTier3Telemetry,
	type ScanContext
} from './recognition-tiers';
import { incrementPersona } from './persona';
import {
	getOrOpenActiveSession,
	recordScan as writerRecordScan,
	updateScanOutcome as writerUpdateScanOutcome
} from './scan-writer';
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
		decisionContext: buildDecisionContext()
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
	onTierChange?: (tier: 1 | 2 | 3) => void,
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

	// Guard: if card database is empty, don't waste API calls on Tier 3.
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
	const ctx: ScanContext = { traceId, lastTier3FailReason: null, cropRegion: options?.cropRegion ?? null, gameHint };

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

	// Session 1.5: the caller (Scanner.svelte) already cropped `bitmap` to the
	// viewfinder region via cropToCanonical, so the Tier 1/2 hashes/OCR run on
	// a known-aspect frame. Tier 3 still sees this same bitmap.
	const workingBitmap = bitmap;

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

	const scanWriteExtras: ScanWriteExtras = {
		telemetry: shutterTelemetry,
		exif: shutterExif,
		qualitySignals: shutterQuality,
		photoWidth: bitmap.width,
		photoHeight: bitmap.height,
		captureSource,
		alignmentStateAtCapture: options?.alignmentStateAtCapture ?? null,
		viewfinder: options?.viewfinder ?? null
	};

	// ── Open scan row EARLY so tier_results can FK to it ────
	// scanIdPromise runs in parallel with tier execution; tier3-claude and
	// recognition-tiers both tolerate a null resolution (unauthenticated
	// scan, or openScanRow failure). Flag gating removed in session 2.10 —
	// unified on the single scan-writer path.
	const scanIdPromise: Promise<string | null> = userId()
		? openScanRow(bitmap, imageSource, scanWriteExtras, gameHint)
			.catch((err) => {
				console.debug(`[scan:${traceId}] openScanRow failed:`, err);
				return null;
			})
		: Promise.resolve(null);

	// ── Check blur (skip if caller already verified quality) ─
	if (!options?.skipBlurCheck) {
		const blurResult = await getImageWorker().checkBlurry(bitmap, BOBA_SCAN_CONFIG.blurThreshold);
		console.debug(`[scan] Blur check: variance=${blurResult.variance.toFixed(1)}, threshold=${BOBA_SCAN_CONFIG.blurThreshold}, isBlurry=${blurResult.isBlurry}`);
		if (blurResult.isBlurry) {
			console.warn(`[scan] Image rejected as blurry (variance ${blurResult.variance.toFixed(1)} < ${BOBA_SCAN_CONFIG.blurThreshold})`);
			patchAbandonedScan(scanIdPromise, 'low_quality_rejected', startTime,
				`blur_variance=${blurResult.variance.toFixed(1)}`);
			if (ownsBitmap) bitmap.close();
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
	// Tier 3 would otherwise be declared.
	const tier3Tel = emptyTier3Telemetry();

	// Helper to record scan result to history and auto-tag before returning
	function finalize(result: ScanResult): ScanResult {
		// Prefer the card's own game_id, then the result's tier-set game_id,
		// then the caller's hint, and finally 'boba' for legacy rows without game_id.
		const resolvedGameId = result.card?.game_id
			|| result.game_id
			|| (gameHint || null)
			|| 'boba';
		const final = { ...result, processing_ms: Math.round(performance.now() - startTime), traceId, game_id: result.card ? resolvedGameId : null };
		const thumbnail = bitmap instanceof ImageBitmap ? createThumbnailDataUrl(bitmap) : null;

		// Create a listing-quality image blob for Supabase Storage upload.
		// This runs async but we attach the promise to the result so callers can await it.
		if (bitmap instanceof ImageBitmap && final.card_id) {
			final._listingImagePromise = createListingImageBlob(bitmap, ctx.cropRegion ?? null);
		}
		addToScanHistory({
			cardNumber: final.card?.card_number ?? null,
			heroName: final.card?.hero_name ?? null,
			imageUrl: thumbnail || (final.card ? getCardImageUrl(final.card) : null),
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

			void scanIdPromise.then((scanId) => {
				if (!scanId) return;

				// Sum per-tier costs into total_cost_usd. Tiers 1 and 2 are
				// free (hash lookup + local OCR). Tier 3 cost duplicates the
				// per-row calc in emitTier3Result — fine for now; fold into
				// a shared helper in the AI Gateway session.
				const tier3CostUsd =
					tier3Tel.llmInputTokens !== null && tier3Tel.llmOutputTokens !== null
						? (tier3Tel.llmInputTokens * 1.0 + tier3Tel.llmOutputTokens * 5.0) / 1_000_000
						: 0;
				const totalCostUsd = tier3CostUsd > 0 ? tier3CostUsd : null;
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
					decisionContext: mergedDecisionCtx
				});
			}).catch((err) => {
				console.debug(`[scan:${traceId}] scan outcome update failed:`, err);
			});
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

	// ── TIER 1 canonical PaddleOCR (Session 2.1a) ───────────
	// Local OCR + rule-based parallel classifier. Runs before Tier 3 (Claude).
	// Gated by live_ocr_tier1_v1; when off, scans fall straight through to Haiku.
	const liveOCREnabled = await isLiveOCRTier1Enabled();
	let liveConsensusReached = !!options?.liveConsensusSnapshot?.consensus?.reachedThreshold;
	// Shared across canonical + TTA telemetry so fallback Haiku rows still
	// carry what canonical / TTA saw when they couldn't close the deal.
	let canonicalTelemetry: {
		perTask: import('./tier1-canonical').CanonicalResult['perTask'];
		ocrStrategy: import('./tier1-canonical').CanonicalResult['ocrStrategy'];
	} | null = null;
	let ttaTelemetry: {
		frames_processed: number;
		consensus_reached: boolean;
		parallel_code: string | null;
		parallel_rule_fired: string | null;
		per_frame_results: unknown[];
		augmentation_set_version: string;
	} | null = null;
	if (liveOCREnabled) {
		onTierChange?.(3); // reuse tier3 UI state for OCR-in-progress
		checkpoint(traceId, 'tier1_canonical:start', performance.now() - startTime);
		try {
			const { runCanonicalTier1 } = await import('./tier1-canonical');
			const { toParallelName } = await import('$lib/data/wonders-parallels');
			const game = (gameHint === 'wonders' ? 'wonders' : 'boba') as 'boba' | 'wonders';
			const canonical = await runCanonicalTier1(workingBitmap, game);
			canonicalTelemetry = {
				perTask: canonical.perTask,
				ocrStrategy: canonical.ocrStrategy
			};

			const liveSnap = options?.liveConsensusSnapshot ?? null;
			const live = liveSnap?.consensus ?? null;
			// Live consensus emits classifier short codes; canonical.parallel is
			// already the human-readable DB name. Map before comparing.
			const liveParallelName = live?.parallel?.value
				? toParallelName(live.parallel.value)
				: null;
			const liveAgreed = !!(
				live?.reachedThreshold &&
				live.cardNumber?.value === canonical.cardNumber &&
				live.name?.value === canonical.name &&
				(game === 'boba' || liveParallelName === canonical.parallel)
			);
			const TIER1_CONFIDENCE_FLOOR = 0.6;

			checkpoint(traceId, 'tier1_canonical:done', performance.now() - startTime, {
				hit: !!canonical.card,
				confidence: canonical.confidence,
				live_reached: liveConsensusReached,
				live_agreed: liveAgreed
			});

			if (canonical.card && canonical.confidence >= TIER1_CONFIDENCE_FLOOR) {
				const divergent: string[] = [];
				if (live) {
					if (live.cardNumber?.value !== canonical.cardNumber) divergent.push('card_number');
					if (live.name?.value !== canonical.name) divergent.push('name');
					if (game === 'wonders' && liveParallelName !== canonical.parallel) divergent.push('parallel');
				}
				const decisionCtx: Record<string, unknown> = {
					live_session: liveSnap,
					canonical_result: canonical.perTask,
					canonical_ocr_strategy: canonical.ocrStrategy,
					live_vs_canonical: {
						live_ran: !!live,
						agreed: liveAgreed,
						divergent_fields: live ? divergent : null
					}
				};
				const tier1Result: ScanResult = {
					card_id: canonical.card.id,
					card: {
						// Map MirrorCard fields onto the Card shape the UI expects.
						// Any missing fields (power, rarity, etc.) will be filled in
						// later by downstream consumers reading from the card DB.
						id: canonical.card.id,
						game_id: canonical.card.game_id,
						card_number: canonical.card.card_number,
						hero_name: canonical.card.hero_name ?? undefined,
						name: canonical.card.name ?? canonical.card.hero_name ?? '',
						set_code: canonical.card.set_code ?? '',
						parallel: canonical.card.parallel ?? undefined
					} as unknown as import('$lib/types').Card,
					scan_method: 'local_ocr',
					confidence: canonical.confidence,
					processing_ms: Math.round(performance.now() - startTime),
					parallel: canonical.parallel,
					game_id: canonical.card.game_id,
					liveConsensusReached,
					liveVsCanonicalAgreed: liveAgreed,
					fallbackTierUsed: null,
					// Distinguishes canonical wins from hash-cache hits in telemetry.
					winningTier: 'tier1_local_ocr',
					decisionContext: decisionCtx
				};
				return finalize(tier1Result);
			}
			// Below confidence floor — fall through to TTA (uploads only) or
			// Tier 3 Haiku. Preserve canonical telemetry for both fallbacks.
			ctx.lastTier3FailReason = null;

			// ── Upload TTA voting (Session 2.1b) ───────────────
			// Only fires on File uploads whose canonical pass couldn't clear
			// the floor. Live captures (ImageBitmap / Blob that came from the
			// camera) skip this — they already had temporal-frame voting via
			// the live OCR coordinator. Gated by upload_tta_v1.
			const ttaEligible = imageSource instanceof File;
			if (ttaEligible) {
				const ttaEnabled = await isUploadTtaEnabled();
				if (ttaEnabled) {
					checkpoint(traceId, 'upload_tta:start', performance.now() - startTime);
					try {
						const { runUploadPipeline } = await import('./upload-pipeline');
						const tta = await runUploadPipeline(workingBitmap, game);
						ttaTelemetry = {
							frames_processed: tta.framesProcessed,
							consensus_reached: tta.consensusReached,
							parallel_code: tta.parallelCode ?? null,
							parallel_rule_fired: tta.parallelRuleFired,
							per_frame_results: tta.perFrameResults,
							augmentation_set_version: tta.augmentationSetVersion
						};
						checkpoint(traceId, 'upload_tta:done', performance.now() - startTime, {
							hit: tta.consensusReached,
							frames: tta.framesProcessed,
							confidence: tta.confidence
						});

						if (tta.consensusReached && tta.card) {
							const ttaDecisionCtx: Record<string, unknown> = {
								canonical_result: canonical.perTask,
								canonical_ocr_strategy: canonical.ocrStrategy,
								upload_tta: ttaTelemetry
							};
							const ttaResult: ScanResult = {
								card_id: tta.card.id,
								card: {
									id: tta.card.id,
									game_id: tta.card.game_id,
									card_number: tta.card.card_number,
									hero_name: tta.card.hero_name ?? undefined,
									name: tta.card.name ?? tta.card.hero_name ?? '',
									set_code: tta.card.set_code ?? '',
									parallel: tta.card.parallel ?? undefined
								} as unknown as import('$lib/types').Card,
								scan_method: 'upload_tta',
								confidence: tta.confidence,
								processing_ms: Math.round(performance.now() - startTime),
								// `tta.parallel` is ALWAYS a human-readable name (resolved
								// through WONDERS_PARALLEL_NAMES in the pipeline). Safe
								// to persist; never a short code.
								parallel: tta.parallel,
								game_id: tta.card.game_id,
								liveConsensusReached,
								liveVsCanonicalAgreed: null,
								fallbackTierUsed: null,
								winningTier: 'tier1_upload_tta',
								decisionContext: ttaDecisionCtx
							};
							return finalize(ttaResult);
						}
						// TTA couldn't converge either — fall through to Haiku with
						// canonical + TTA metadata attached.
					} catch (err) {
						checkpoint(traceId, 'upload_tta:threw', performance.now() - startTime, {
							error: err instanceof Error ? err.message : String(err)
						});
						console.warn('[scan] Upload TTA failed, falling through to Tier 3:', err);
					}
				}
			}
		} catch (err) {
			checkpoint(traceId, 'tier1_canonical:threw', performance.now() - startTime, {
				error: err instanceof Error ? err.message : String(err)
			});
			console.warn('[scan] Tier 1 canonical failed, falling through to Tier 3:', err);
		}
	}

	// ── TIER 3: Claude API ──────────────────────────────────
	// Anonymous users are allowed — server-side rate limit (5/60s per IP) protects against abuse
	onTierChange?.(3);
	console.debug('[scan] Starting Tier 3: Claude AI identification...');
	checkpoint(traceId, 'tier3:start', performance.now() - startTime);
	let tier3Result: ScanResult | null = null;
	try {
		// No outer race: the fetch to /api/scan is the only network op and it's
		// bounded by the server-side Anthropic client + Vercel function timeout.
		// runTier3 emits its scan_tier_results row inside try/finally now.
		tier3Result = await runTier3(workingBitmap, ctx, tier3Tel, scanIdPromise);
		checkpoint(traceId, 'tier3:done', performance.now() - startTime, {
			hit: tier3Result !== null,
			outcome: tier3Tel.outcome
		});
	} catch (err) {
		checkpoint(traceId, 'tier3:threw', performance.now() - startTime, {
			error: err instanceof Error ? err.message : String(err)
		});
		console.warn('[scan] Tier 3 threw:', err);
	}
	if (tier3Result && liveOCREnabled) {
		// Tag the Haiku-fallback telemetry fields so analytics can split
		// flag-on-and-tier3-rescued vs flag-off runs.
		tier3Result.fallbackTierUsed = 'haiku';
		tier3Result.liveConsensusReached = liveConsensusReached;
		tier3Result.liveVsCanonicalAgreed = null;
		// Preserve what canonical / TTA saw so we can debug which stage
		// would have caught which card. Merged with anything Tier 3 already
		// set on decisionContext.
		if (canonicalTelemetry || ttaTelemetry) {
			tier3Result.decisionContext = {
				...(tier3Result.decisionContext ?? {}),
				...(canonicalTelemetry
					? {
						canonical_result: canonicalTelemetry.perTask,
						canonical_ocr_strategy: canonicalTelemetry.ocrStrategy
					}
					: {}),
				...(ttaTelemetry ? { upload_tta: ttaTelemetry } : {})
			};
		}
	}
	if (tier3Result) {
		console.debug(`[scan] Tier 3 HIT: card_id=${tier3Result.card_id}, card=${tier3Result.card?.card_number}, confidence=${tier3Result.confidence}, game=${tier3Result.game_id ?? tier3Result.card?.game_id ?? gameHint}, parallel=${tier3Result.parallel}`);
		return finalize(tier3Result);
	}
	console.warn('[scan] Tier 3 MISS: Claude could not identify card (see earlier logs for details)');
	// All tiers exhausted — resolved with null final_card_id. Keeps this
	// cohort separate from infra abandonments in outcomeDistribution.
	patchAbandonedScan(scanIdPromise, 'resolved', startTime,
		ctx.lastTier3FailReason || 'all_tiers_no_match');
	return finalize(
		{ card_id: null, card: null, scan_method: 'claude' as ScanMethod, confidence: 0, processing_ms: Math.round(performance.now() - startTime), failReason: ctx.lastTier3FailReason || 'AI could not identify this card' }
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

