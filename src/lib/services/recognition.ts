/**
 * Three-Tier Recognition Pipeline — Orchestrator
 *
 * Coordinates the three recognition tiers (hash, OCR, Claude AI),
 * manages the scan lifecycle, and handles cache writeback.
 *
 * Tier functions live in recognition-tiers.ts.
 * Cross-validation logic lives in recognition-validation.ts.
 * Worker management lives in recognition-workers.ts.
 */

import { idb } from './idb';
import { loadCardDatabase } from './card-db';
import { getSupabase } from './supabase';
import { recordCorrection } from '$lib/services/scan-learning';
import { initOcr } from '$lib/services/ocr';
import { getCardImageUrl } from '$lib/utils/image-url';
import { addToScanHistory } from '$lib/stores/scan-history.svelte';
import { trackScanMetric } from '$lib/services/error-tracking';
import { userId } from '$lib/stores/auth.svelte';
import { submitReferenceImage } from '$lib/services/reference-images';
import { BOBA_SCAN_CONFIG, BOBA_PIPELINE_CONFIG } from '$lib/data/boba-config';
import type { ScanResult, ScanMethod } from '$lib/types';
import { createThumbnailDataUrl, createListingImageBlob } from './scan-image-utils';
import {
	getImageWorker,
	initWorkers,
	isOcrAvailable,
	wasOcrRetryAttempted,
	markOcrRetryAttempted,
	markOcrAvailable
} from './recognition-workers';
import {
	runTier1,
	runTier1Embedding,
	runTier2,
	runTier3,
	emptyTier1Telemetry,
	emptyTier2Telemetry,
	emptyTier3Telemetry,
	emitTier2Result,
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
export { disableFuzzyHashRpc, isFuzzyHashRpcDisabled } from './recognition-tiers';

/** Circuit breaker: disable upsert hash cache RPC for the session if it fails once */
let _upsertHashRpcDisabled = false;

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
	/** Which Tier 1 path ran for this scan (Session 1.6). */
	tier1Engine: 'phash' | 'embedding';
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
		// Session 1.6 adds tier1_engine so hit-rate views can split
		// embedding runs from pHash runs.
		captureContext: {
			alignment_state_at_capture: extras.alignmentStateAtCapture,
			viewfinder_x: extras.viewfinder?.x ?? null,
			viewfinder_y: extras.viewfinder?.y ?? null,
			viewfinder_width: extras.viewfinder?.width ?? null,
			viewfinder_height: extras.viewfinder?.height ?? null,
			tier1_engine: extras.tier1Engine
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
 * scans.winning_tier column.
 */
function winningTierFromResult(result: ScanResult): string {
	switch (result.scan_method) {
		case 'hash_cache': return 'tier1_hash';
		case 'tesseract': return 'tier2_ocr';
		case 'claude': return 'tier3_claude';
		case 'manual':
		default: return 'manual';
	}
}

/**
 * LEGACY — writes to the dropped pre-0.1 `scans` table shape.
 * Retained only as a rollback path while `new_scan_pipeline` flag is off.
 * Remove entirely in Phase 1 once new writer has baked for 48h.
 */
async function logScanToSupabaseLegacy(result: ScanResult): Promise<void> {
	const uid = userId();
	if (!uid || !result.card_id) return;

	const client = getSupabase();
	if (!client) return;

	try {
		// TODO: migrate to new scan schema (Phase 1) — this legacy path writes to
		// columns that no longer exist post-0.1. Retained until new_scan_pipeline
		// flag is default-on for 48h, then delete this function entirely.
		const { error: scanError } = await client.from('scans').insert({
			user_id: uid,
			card_id: result.card_id,
			hero_name: result.card?.hero_name ?? null,
			card_number: result.card?.card_number ?? null,
			scan_method: result.scan_method ?? 'unknown',
			confidence: result.confidence ?? null,
			processing_ms: result.processing_ms ?? null,
			game_id: result.game_id || 'boba'
		} as never);
		if (scanError) {
			console.error('[scan] Supabase scan log FAILED:', scanError.message);
		}
		// Phase 5A: passive persona tracking. Fire-and-forget.
		incrementPersona(client, 'collector');
	} catch (err) {
		console.error('[scan] Supabase scan log exception:', err);
	}
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

	// Guard: if card database is empty, don't waste API calls on Tier 3
	if (loadedCards.length === 0) {
		console.warn(`[scan:${traceId}] Card database empty — aborting pipeline`);
		return {
			card_id: null,
			card: null,
			scan_method: 'hash_cache' as ScanMethod,
			confidence: 0,
			processing_ms: Math.round(performance.now() - startTime),
			failReason: 'Card database unavailable — please check your connection and try again'
		};
	}

	console.debug(`[scan:${traceId}] Pipeline started. ${loadedCards.length} cards loaded (games=${isAutoDetect ? 'auto' : gameHint}).`);

	// Per-scan context to avoid global state pollution across concurrent scans
	const ctx: ScanContext = { traceId, lastOcrReading: null, lastTier3FailReason: null, cropRegion: options?.cropRegion ?? null, gameHint };

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
		return {
			card_id: null,
			card: null,
			scan_method: 'hash_cache' as ScanMethod,
			confidence: 0,
			processing_ms: Math.round(performance.now() - startTime),
			failReason: 'Image buffer was lost during processing — please try again'
		};
	}

	// ── Tier 1 engine selection (Session 1.6) ──────────────
	// Resolved before openScanRow so capture_context.tier1_engine is written
	// at INSERT time. The flag is read once per scan so a mid-scan flag flip
	// doesn't split the telemetry for this scan across engines.
	const embeddingTier1Enabled = await isEmbeddingTier1Enabled().catch(() => false);
	const tier1Engine: 'phash' | 'embedding' = embeddingTier1Enabled ? 'embedding' : 'phash';

	const scanWriteExtras: ScanWriteExtras = {
		telemetry: shutterTelemetry,
		exif: shutterExif,
		qualitySignals: shutterQuality,
		photoWidth: bitmap.width,
		photoHeight: bitmap.height,
		captureSource,
		alignmentStateAtCapture: options?.alignmentStateAtCapture ?? null,
		viewfinder: options?.viewfinder ?? null,
		tier1Engine
	};

	// ── Open scan row EARLY so tier_results can FK to it ────
	// The flag check + scan row INSERT run in parallel with tier execution.
	// If the flag is off (legacy path), scanIdPromise resolves to null and
	// no tier_results are emitted — finalize() falls back to legacy write.
	const newPipelineEnabledPromise = isNewScanPipelineEnabled();
	const scanIdPromise: Promise<string | null> = userId()
		? newPipelineEnabledPromise
			.then((enabled) => {
				if (!enabled) return null;
				return openScanRow(bitmap, imageSource, scanWriteExtras, gameHint);
			})
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
			if (ownsBitmap) bitmap.close();
			return {
				card_id: null,
				card: null,
				scan_method: 'hash_cache',
				confidence: 0,
				processing_ms: Math.round(performance.now() - startTime),
				failReason: 'Image too blurry — try holding the card steady with better lighting'
			};
		}
	}

	// Declared here (not at each tier's run site) so finalize() can close over
	// them on every exit path — including early Tier 1/offline returns that
	// happen before Tier 2/3 would otherwise be declared.
	const tier1Tel = emptyTier1Telemetry();
	const tier2Tel = emptyTier2Telemetry();
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

		// Persist to Supabase for cross-device consistency (non-blocking)
		// Feature-flagged dual-write: new pipeline when enabled, legacy otherwise.
		// Both paths are fire-and-forget; neither affects scan completion.
		//
		// Session 1.1.1f: two telemetry writes so we can see from MCP what
		// actually happens. Throwaway — delete after bug is identified.
		if (final.card_id) {
			void newPipelineEnabledPromise.then(async (enabled) => {
				// Telemetry 1: what did the flag check return?
				void traceScanPipeline('flag_check_result', {
					enabled,
					card_id: final.card_id,
					game_id: final.game_id ?? null,
					scan_method: final.scan_method ?? null,
					trace_id: traceId
				});

				if (enabled) {
					// Telemetry 2: we're about to update the scan outcome
					void traceScanPipeline('writer_entry', {
						branch: 'new',
						card_id: final.card_id,
						trace_id: traceId
					});
					const scanId = await scanIdPromise;
					if (scanId) {
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
							liveConsensusReached: final.liveConsensusReached ?? null,
							liveVsCanonicalAgreed: final.liveVsCanonicalAgreed ?? null,
							fallbackTierUsed: final.fallbackTierUsed ?? null,
							decisionContext: mergedDecisionCtx
						});
						// Preserve the persona increment from the old logScanToSupabaseNew path.
						const client = getSupabase();
						if (client) incrementPersona(client, 'collector');
					}
				} else {
					void traceScanPipeline('writer_entry', {
						branch: 'legacy',
						card_id: final.card_id,
						trace_id: traceId
					});
					logScanToSupabaseLegacy(final);
				}
			}).catch((err) => {
				void traceScanPipeline('flag_check_threw', {
					error: err instanceof Error ? err.message : String(err),
					trace_id: traceId
				});
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

		// Auto-tag card with its parallel name
		if (final.card?.parallel && final.card_id) {
			import('$lib/stores/tags.svelte').then(({ addTag }) => {
				addTag(final.card_id!, final.card!.parallel!);
			}).catch((err) => console.debug('[scan] Auto-tag failed:', err));
		}

		return final;
	}

	// ── TIER 1: Hash or Embedding Lookup ─────────────────────
	// All tiers operate on `workingBitmap`, which is the viewfinder-cropped
	// canonical 500×700 frame produced by Scanner.svelte's capture flow.
	// Session 1.6: gated by 'embedding_tier1' — if enabled, DINOv2-based
	// nearest-neighbor replaces pHash. pHash remains the default.
	onTierChange?.(1);
	console.debug(`[scan] Starting Tier 1 (${tier1Engine}) lookup...`);
	checkpoint(traceId, 'tier1:start', performance.now() - startTime, { engine: tier1Engine });
	let tier1Result: ScanResult | null = null;
	try {
		tier1Result = tier1Engine === 'embedding'
			? await runTier1Embedding(workingBitmap, ctx, writeHashToAllLayers, tier1Tel, scanIdPromise)
			: await runTier1(workingBitmap, ctx, writeHashToAllLayers, tier1Tel, scanIdPromise);
		checkpoint(traceId, 'tier1:done', performance.now() - startTime, {
			hit: tier1Result !== null,
			outcome: tier1Tel.outcome,
			engine: tier1Engine
		});
		if (tier1Result) {
			console.debug(`[scan] Tier 1 (${tier1Engine}) HIT: card_id=${tier1Result.card_id}, card=${tier1Result.card?.card_number}, confidence=${tier1Result.confidence}`);
		} else {
			console.debug(`[scan] Tier 1 (${tier1Engine}) MISS`);
		}
	} catch (err) {
		checkpoint(traceId, 'tier1:threw', performance.now() - startTime, {
			error: err instanceof Error ? err.message : String(err)
		});
		console.warn(`[scan:${ctx.traceId}] Tier 1 failed, falling through:`, err);
	}
	if (tier1Result) {
		return finalize(tier1Result);
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
		return finalize({
			card_id: null,
			card: null,
			scan_method: 'hash_cache' as ScanMethod,
			confidence: 0,
			processing_ms: Math.round(performance.now() - startTime),
			failReason: 'Offline — scan queued for when you reconnect'
		});
	}

	// ── TIER 2: OCR + Fuzzy Match ────────────────────────────
	// One-time retry if OCR failed during initial setup.
	// Set the flag BEFORE the await to prevent concurrent scans from both retrying.
	if (!isOcrAvailable() && !wasOcrRetryAttempted() && navigator.onLine) {
		markOcrRetryAttempted();
		try {
			await Promise.race([
				initOcr(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('OCR retry timed out')), 10000)
				)
			]);
			markOcrAvailable();
			console.debug('[scan] Tesseract OCR initialized on retry');
		} catch (err) {
			console.warn('[scan] Tesseract OCR retry failed — Tier 2 remains disabled:', err);
		}
	}

	if (isOcrAvailable()) {
		onTierChange?.(2);
		console.debug('[scan] Starting Tier 2: OCR card number extraction...');
		checkpoint(traceId, 'tier2:start', performance.now() - startTime);
		let tier2Result: ScanResult | null = null;
		try {
			// No outer race: Tier 2's per-region OCR calls already use withTimeout
			// against a TIER2_BUDGET_MS budget that early-exits when exhausted.
			// runTier2 emits its scan_tier_results row inside try/finally now.
			tier2Result = await runTier2(workingBitmap, ctx, tier2Tel, scanIdPromise);
			checkpoint(traceId, 'tier2:done', performance.now() - startTime, {
				hit: tier2Result !== null,
				outcome: tier2Tel.outcome
			});
			if (tier2Result) {
				console.debug(`[scan] Tier 2 HIT: card_id=${tier2Result.card_id}, card=${tier2Result.card?.card_number}, confidence=${tier2Result.confidence}, game=${tier2Result.game_id ?? tier2Result.card?.game_id ?? gameHint}`);
			} else {
				console.debug('[scan] Tier 2 MISS: OCR could not match a card number');
			}
		} catch (err) {
			checkpoint(traceId, 'tier2:threw', performance.now() - startTime, {
				error: err instanceof Error ? err.message : String(err)
			});
			// OCR failure is non-fatal — fall through to Tier 3
			console.warn('[scan] Tier 2 error (falling through to Tier 3):', err);
		}
		if (tier2Result) {
			const hash = await getImageWorker().computeDHash(workingBitmap);
			const hashGameId = tier2Result.card?.game_id || tier2Result.game_id || gameHint || 'boba';
			// Tier 2 can't detect parallel visually. Read from the matched card —
			// cards.parallel is the source of truth. The Tier 2 confirmation UI
			// forces the user to choose parallel before the collection entry is
			// created, so the collection row records the truth regardless of
			// what the hash cache says.
			const hashParallel = tier2Result.card?.parallel ?? tier2Result.parallel ?? 'Paper';
			await writeHashToAllLayers(hash, tier2Result.card_id!, tier2Result.confidence, workingBitmap, hashGameId, hashParallel);
			return finalize(tier2Result);
		}
	} else {
		// runTier2 isn't called in the OCR-unavailable path, so emit the skip row
		// from out here. Inside-tier emit is the rule for runTier1/2/3 invocations;
		// this is the lone exception where the tier function itself never runs.
		console.debug('[scan] Tier 2 skipped: OCR not available');
		tier2Tel.attempted = false;
		tier2Tel.skipReason = 'ocr_unavailable';
		tier2Tel.outcome = 'skipped';
		void scanIdPromise.then(async (sid) => {
			if (!sid) return;
			try {
				await emitTier2Result(sid, tier2Tel);
			} catch (err) {
				console.debug('[scan] Tier 2 skip emit failed:', err);
			}
		});
	}

	// ── TIER 1 canonical PaddleOCR (Session 2.1a) ───────────
	// Local OCR + rule-based parallel classifier. Runs between the existing
	// Tier 2 (Tesseract) and Tier 3 (Claude). Gated by live_ocr_tier1_v1 so
	// the old Haiku-first behavior stays intact when the flag is off.
	const liveOCREnabled = await isLiveOCRTier1Enabled();
	let liveConsensusReached = !!options?.liveConsensusSnapshot?.consensus?.reachedThreshold;
	if (liveOCREnabled) {
		onTierChange?.(3); // reuse tier3 UI state for OCR-in-progress
		checkpoint(traceId, 'tier1_canonical:start', performance.now() - startTime);
		try {
			const { runCanonicalTier1 } = await import('./tier1-canonical');
			const { toParallelName } = await import('$lib/data/wonders-parallels');
			const game = (gameHint === 'wonders' ? 'wonders' : 'boba') as 'boba' | 'wonders';
			const canonical = await runCanonicalTier1(workingBitmap, game);

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
					scan_method: 'hash_cache' as ScanMethod,
					confidence: canonical.confidence,
					processing_ms: Math.round(performance.now() - startTime),
					parallel: canonical.parallel,
					game_id: canonical.card.game_id,
					liveConsensusReached,
					liveVsCanonicalAgreed: liveAgreed,
					fallbackTierUsed: null,
					decisionContext: decisionCtx
				};
				return finalize(tier1Result);
			}
			// Below confidence floor — fall through to Tier 3 Haiku.
			ctx.lastTier3FailReason = null;
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
	}
	if (tier3Result) {
		console.debug(`[scan] Tier 3 HIT: card_id=${tier3Result.card_id}, card=${tier3Result.card?.card_number}, confidence=${tier3Result.confidence}, game=${tier3Result.game_id ?? tier3Result.card?.game_id ?? gameHint}, parallel=${tier3Result.parallel}`);
		const hash = await getImageWorker().computeDHash(workingBitmap);
		const hashGameId = tier3Result.card?.game_id || tier3Result.game_id || gameHint || 'boba';
		// Tier 3 parallel comes from cards.parallel (the source of truth for the
		// matched card) — fall back to the result's parallel field, then 'Paper'.
		const hashParallel = tier3Result.card?.parallel ?? tier3Result.parallel ?? 'Paper';
		await writeHashToAllLayers(hash, tier3Result.card_id!, tier3Result.confidence, workingBitmap, hashGameId, hashParallel);

		// Record correction: Tier 2 read something but couldn't match; Tier 3 found the right card.
		if (tier3Result.card_id && tier3Result.card?.card_number && ctx.lastOcrReading) {
			recordCorrection(ctx.lastOcrReading, tier3Result.card.card_number, 'ai');
		}
		return finalize(tier3Result);
	}
	console.warn('[scan] Tier 3 MISS: Claude could not identify card (see earlier logs for details)');
	return finalize(
		{ card_id: null, card: null, scan_method: 'claude' as ScanMethod, confidence: 0, processing_ms: Math.round(performance.now() - startTime), failReason: ctx.lastTier3FailReason || 'AI could not identify this card' }
	);
}



// ── Cache Writeback ─────────────────────────────────────────

async function writeHashToAllLayers(
	hash: string,
	cardId: string,
	confidence: number,
	bitmap?: ImageBitmap,
	gameId: string = 'boba',
	parallel: string = 'Paper'
): Promise<void> {
	// Compute pHash if bitmap is available (for enhanced matching)
	let phash256: string | null = null;
	if (bitmap) {
		try {
			phash256 = await getImageWorker().computePHash(bitmap, 16);
		} catch (err) {
			console.debug('[scan] pHash computation failed:', err);
		}
	}

	// Layer 1: IndexedDB
	try {
		await idb.setHash({ phash: hash, card_id: cardId, confidence, game_id: gameId, parallel, ...(phash256 ? { phash_256: phash256 } : {}) });
	} catch (err) {
		console.debug('[scan] IDB hash write failed:', err);
	}

	// Layer 3: Supabase (atomic scan_count increment via RPC)
	if (!_upsertHashRpcDisabled) {
		try {
			const client = getSupabase();
			if (client) {
				const rpcArgs: { p_phash: string; p_card_id: string; p_confidence: number; p_phash_256?: string; p_game_id: string; p_parallel: string } = {
					p_phash: hash,
					p_card_id: cardId,
					p_confidence: confidence,
					p_game_id: gameId,
					p_parallel: parallel,
				};
				if (phash256) rpcArgs.p_phash_256 = phash256;
				const { error: rpcErr } = await client.rpc('upsert_hash_cache', rpcArgs);
				if (rpcErr) {
					console.debug('[scan] Supabase hash writeback RPC error:', rpcErr.message);
					_upsertHashRpcDisabled = true;
				}
			}
		} catch (err) {
			console.debug('[scan] Supabase hash writeback failed:', err);
		}
	}

	// Layer 4: Reference image competition
	// Automatically submit high-confidence scans as candidate reference images.
	// The server-side RPC handles the atomic "beat the champion" logic.
	// This runs in the background — it never blocks the scan result.
	//
	// IMPORTANT: We must do the bitmap work (resize + blur check) SYNCHRONOUSLY
	// before this function returns, because the caller will close the bitmap
	// in a finally block. Only the network upload is fire-and-forget.
	if (bitmap && confidence >= BOBA_PIPELINE_CONFIG.referenceImageMinConfidence) {
		try {
			// Do bitmap operations NOW, before the caller closes the bitmap
			const worker = getImageWorker();
			const uploadBlob = await worker.resizeForUpload(bitmap, 800);
			const { variance: blurVariance } = await worker.checkBlurry(bitmap, 100);

			// Only the network submission is fire-and-forget
			if (blurVariance > BOBA_PIPELINE_CONFIG.referenceImageMinVariance) {
				submitReferenceImage(cardId, confidence, uploadBlob, blurVariance)
					.catch(err => console.debug('[scan] Reference image submission failed:', err));
			}
		} catch (err) {
			console.debug('[scan] Reference image preparation failed:', err);
		}
	}
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
 * Session 1.1.1f telemetry helper. Writes a row to scan_pipeline_trace
 * from the browser's authenticated client so MCP can read what happened
 * inside the scan path. Throwaway — delete after pipeline debugging done.
 */
async function traceScanPipeline(
	eventName: string,
	eventData: Record<string, unknown>
): Promise<void> {
	try {
		const client = getSupabase();
		if (!client) return;
		await client.from('scan_pipeline_trace').insert({
			event_name: eventName,
			event_data: eventData
		} as never);
	} catch {
		// Swallow — telemetry failure must never break a scan
	}
}

/**
 * Session 1.6 gate. Returns true when Tier 1 should run the DINOv2
 * embedding path instead of pHash. Admin-only at launch; widen after
 * measuring real-traffic hit rate via tier1_hit_rate_v1.
 */
async function isEmbeddingTier1Enabled(): Promise<boolean> {
	try {
		const flagsModule = await import('$lib/stores/feature-flags.svelte');
		return flagsModule.featureEnabled('embedding_tier1')();
	} catch {
		return false;
	}
}

/**
 * Session 2.1a gate. Returns true when Tier 1 should run the local
 * PaddleOCR canonical path (with live-OCR voting hint). When off, the
 * legacy Claude-Haiku-first behavior is preserved exactly.
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
 * Phase 0.3 rollout flag. Returns true when the new scan-writer should run.
 * Default off until admin-verified; flip for authenticated users in Phase 1.
 */
async function isNewScanPipelineEnabled(): Promise<boolean> {
	try {
		// Lazy dynamic import to avoid a potential circular dependency with
		// feature-flags (which imports Supabase, also imported by scan-writer).
		const flagsModule = await import('$lib/stores/feature-flags.svelte');
		const { featureEnabled, getUserProfile } = flagsModule;
		const authModule = await import('$lib/stores/auth.svelte');

		const result = featureEnabled('new_scan_pipeline')();

		// Session 1.1.1g telemetry: capture what the store sees when flag returns false.
		// Throwaway — remove in next session after bug is identified.
		if (!result) {
			void traceScanPipeline('flag_resolver_state', {
				flag_result: result,
				user_present: authModule.user() !== null,
				user_id: authModule.userId(),
				profile: getUserProfile ? getUserProfile() : 'getUserProfile_not_exported',
				flag_definition_present: !!(flagsModule as unknown as { _featureFlags?: unknown })._featureFlags
			});
		}

		return result;
	} catch (err) {
		void traceScanPipeline('flag_check_threw', {
			error: err instanceof Error ? err.message : String(err)
		});
		return false;
	}
}

