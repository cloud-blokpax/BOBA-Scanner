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
	runTier2,
	runTier3,
	emptyTier1Telemetry,
	emptyTier2Telemetry,
	emptyTier3Telemetry,
	type ScanContext,
	type Tier1Telemetry,
	type Tier2Telemetry,
	type Tier3Telemetry
} from './recognition-tiers';
import { incrementPersona } from './persona';
import {
	getOrOpenActiveSession,
	recordScan as writerRecordScan,
	recordTierResult as writerRecordTierResult,
	updateScanOutcome as writerUpdateScanOutcome
} from './scan-writer';
import { captureScanTelemetry, getBatteryStatus } from './scan-telemetry';
import { parseExifSafe } from '$lib/utils/exif';

/**
 * Decision thresholds captured per scan so future analysis can replay
 * how a decision was reached without referring back to source control.
 * Any time these move, bump the values here so the replay is accurate.
 */
const DECISION_CONTEXT = {
	dhash_max_distance_fuzzy: 5,
	phash_verification_max_distance: 20,
	phash_256_max_distance: 40,
	tier1_min_confidence: 0.8,
	hash_algo_version: 'dhash-krawetz-v1+phash-dct-v2',
	rectification_enabled: true
} as const;

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
	/** Did the OpenCV quad-detect pass succeed for this scan? */
	rectificationSucceeded: boolean;
	/** Aspect-ratio fit score in [0, 1] when rectification ran. */
	rectificationConfidence: number | null;
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

		// Capture-time rectification outcome. Stored in capture_context JSONB
		// so we can correlate Tier 1 hit rate with rectification success.
		captureContext: {
			rectification_succeeded: extras.rectificationSucceeded,
			rectification_confidence: extras.rectificationConfidence
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
		decisionContext: { ...DECISION_CONTEXT }
	});
	return scanId;
}

function emitTier1Result(scanId: string, t: Tier1Telemetry): void {
	void writerRecordTierResult({
		scanId,
		tier: 'tier1_hash',
		engine: 'phash',
		engineVersion: 'phash-v1',
		rawOutput: {
			query_dhash: t.queryDhash,
			query_phash_256: t.queryPhash256,
			idb_cache_hit: t.idbCacheHit,
			sb_exact_hit: t.sbExactHit,
			sb_fuzzy_hit: t.sbFuzzyHit
		},
		queryDhash: t.queryDhash,
		queryPhash256: t.queryPhash256,
		latencyMs: t.latencyMs,
		errored: t.outcome === 'error',
		errorMessage: t.errorMessage,
		outcome: t.outcome,
		ranAt: new Date(),
		topnCandidates: t.topnCandidates as Array<Record<string, unknown>> | null,
		idbCacheHit: t.idbCacheHit,
		sbExactHit: t.sbExactHit,
		sbFuzzyHit: t.sbFuzzyHit,
		winnerDhashDistance: t.winnerDhashDistance,
		winnerPhashDistance: t.winnerPhashDistance,
		runnerUpMarginDhash: t.runnerUpMarginDhash,
		hashMatchCount: t.hashMatchCount
	});
}

function emitTier2Result(scanId: string, t: Tier2Telemetry): void {
	void writerRecordTierResult({
		scanId,
		tier: 'tier2_ocr',
		engine: 'tesseract_v5',
		engineVersion: 'tesseract-5',
		rawOutput: {
			attempted: t.attempted,
			regions_attempted: t.regionsAttempted,
			regions_succeeded: t.regionsSucceeded
		},
		latencyMs: t.latencyMs,
		errored: t.outcome === 'error',
		errorMessage: t.errorMessage,
		outcome: t.outcome,
		skipReason: t.skipReason,
		ranAt: new Date(),
		ocrTextRaw: t.ocrTextRaw,
		ocrMeanConfidence: t.ocrMeanConfidence,
		ocrWordCount: t.ocrWordCount,
		ocrDetectedCardNumber: t.ocrDetectedCardNumber
	});
}

function emitTier3Result(scanId: string, t: Tier3Telemetry): void {
	// Cost calculation for Haiku 4.5 (claude-haiku-4-5-20251001).
	// Pricing: $1.00/M input tokens, $5.00/M output tokens as of 2026-04.
	// When we add AI Gateway, this moves to the gateway's automatic capture.
	const costUsd =
		t.llmInputTokens !== null && t.llmOutputTokens !== null
			? (t.llmInputTokens * 1.0 + t.llmOutputTokens * 5.0) / 1_000_000
			: null;

	void writerRecordTierResult({
		scanId,
		tier: 'tier3_claude',
		engine: 'claude_haiku',
		engineVersion: t.llmModelResponded ?? 'claude-haiku-4-5-20251001',
		rawOutput: (t.rawResponse ?? {}) as Record<string, unknown>,
		latencyMs: t.latencyMs,
		costUsd,
		errored: t.outcome === 'error',
		errorMessage: t.errorMessage,
		outcome: t.outcome,
		skipReason: t.skipReason,
		ranAt: new Date(),
		llmModelRequested: t.llmModelRequested,
		llmModelResponded: t.llmModelResponded,
		llmInputTokens: t.llmInputTokens,
		llmOutputTokens: t.llmOutputTokens,
		llmCacheCreationTokens: t.llmCacheCreationTokens,
		llmCacheReadTokens: t.llmCacheReadTokens,
		llmFinishReason: t.llmFinishReason,
		promptTemplateVersion: 'phase2.5',
		pricingTableVersion: 'haiku-4.5-2026-04',
		claudeReturnedNameInCatalog: t.claudeReturnedNameInCatalog
	});
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
 * @param imageSource - File, Blob, or ImageBitmap to scan
 * @param onTierChange - Optional callback for UI progress updates
 * @returns ScanResult with matched card data
 */
export async function recognizeCard(
	imageSource: File | Blob | ImageBitmap,
	onTierChange?: (tier: 1 | 2 | 3) => void,
	options?: { isAuthenticated?: boolean; skipBlurCheck?: boolean; cropRegion?: { x: number; y: number; width: number; height: number } | null; gameHint?: string | null }
): Promise<ScanResult> {
	const traceId = crypto.randomUUID().slice(0, 8);
	const startTime = performance.now();
	await initWorkers();

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
	try {
		shutterQuality = await getImageWorker().computeQualitySignals(bitmap);
	} catch (err) {
		console.debug('[scan] computeQualitySignals failed, continuing:', err);
	}

	// ── Card rectification (OpenCV.js) ────────────────────────
	// Detect the card quad and warp to a canonical 500×700 bitmap. Phone
	// photos have 15+ bits of dHash variance for the same card uncropped;
	// rectifying to a canonical frame collapses that variance so hash-based
	// matching can actually resolve. Every failure mode — OpenCV load error,
	// no quad found, runtime exception — returns null and we fall through
	// to the raw bitmap. Pipeline strictly improves, never degrades.
	let rectified: Awaited<ReturnType<ReturnType<typeof getImageWorker>['rectifyCard']>> = null;
	try {
		rectified = await getImageWorker().rectifyCard(bitmap);
	} catch (err) {
		console.debug('[scan] rectifyCard threw, falling back to raw bitmap:', err);
	}
	const workingBitmap = rectified?.bitmap ?? bitmap;
	const ownsWorkingBitmap = rectified !== null; // we created this one; release it on exit
	if (rectified) {
		console.debug(
			`[scan:${traceId}] Rectification succeeded (confidence=${rectified.confidence.toFixed(3)})`
		);
	} else {
		console.debug(`[scan:${traceId}] Rectification miss — hashing uncropped bitmap`);
	}

	const scanWriteExtras: ScanWriteExtras = {
		telemetry: shutterTelemetry,
		exif: shutterExif,
		qualitySignals: shutterQuality,
		photoWidth: bitmap.width,
		photoHeight: bitmap.height,
		captureSource,
		rectificationSucceeded: rectified !== null,
		rectificationConfidence: rectified?.confidence ?? null
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
			if (ownsWorkingBitmap) workingBitmap.close();
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
						void writerUpdateScanOutcome({
							scanId,
							winningTier: winningTierFromResult(final),
							// string; Postgres casts to uuid. Assumes recognize-card
							// returns a valid UUID (validated upstream).
							finalCardId: final.card_id!,
							finalConfidence: final.confidence ?? null,
							finalVariant: final.variant ?? null,
							totalLatencyMs: final.processing_ms ?? null,
							totalCostUsd
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
			// Phase 2.5: variant diagnostics so we can audit misidentifications.
			// `user_confirmed_variant` is recorded separately at collection-add time
			// (see addToCollection) because that's where the user's final choice lives.
			game_id: final.game_id ?? null,
			detected_variant: final.variant ?? null,
			variant_confidence: final.variant_confidence ?? null,
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

	// ── TIER 1: Perceptual Hash Lookup ──────────────────────
	// Every tier operates on `workingBitmap` — the rectified frame if
	// detection succeeded, otherwise the raw bitmap. Hash cache writebacks
	// also store the rectified-frame hash so future scans of the same card
	// hit the same cache row.
	onTierChange?.(1);
	console.debug('[scan] Starting Tier 1: Hash Cache lookup...');
	let tier1Result: ScanResult | null = null;
	try {
		tier1Result = await runTier1(workingBitmap, ctx, writeHashToAllLayers, tier1Tel);
		if (tier1Result) {
			console.debug(`[scan] Tier 1 HIT: card_id=${tier1Result.card_id}, card=${tier1Result.card?.card_number}, confidence=${tier1Result.confidence}`);
		} else {
			console.debug('[scan] Tier 1 MISS: no hash match found');
		}
	} catch (err) {
		console.warn(`[scan:${ctx.traceId}] Tier 1 failed, falling through:`, err);
	}
	// Emit Tier 1 telemetry regardless of hit/miss/error
	void scanIdPromise.then((sid) => { if (sid) emitTier1Result(sid, tier1Tel); });
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
		let tier2Result: ScanResult | null = null;
		try {
			tier2Result = await runTier2(workingBitmap, ctx, tier2Tel);
			if (tier2Result) {
				console.debug(`[scan] Tier 2 HIT: card_id=${tier2Result.card_id}, card=${tier2Result.card?.card_number}, confidence=${tier2Result.confidence}, game=${tier2Result.game_id ?? tier2Result.card?.game_id ?? gameHint}`);
			} else {
				console.debug('[scan] Tier 2 MISS: OCR could not match a card number');
			}
		} catch (err) {
			// OCR failure is non-fatal — fall through to Tier 3
			console.warn('[scan] Tier 2 error (falling through to Tier 3):', err);
		}
		// Emit Tier 2 telemetry regardless of hit/miss/error
		void scanIdPromise.then((sid) => { if (sid) emitTier2Result(sid, tier2Tel); });
		if (tier2Result) {
			const hash = await getImageWorker().computeDHash(workingBitmap);
			const hashGameId = tier2Result.card?.game_id || tier2Result.game_id || gameHint || 'boba';
			// Tier 2 can't detect variant visually. Default to 'paper' in the hash
			// cache — the Tier 2 confirmation UI forces the user to choose variant
			// before the collection entry is created, so the collection row records
			// the truth regardless of what the hash cache says.
			const hashVariant = tier2Result.variant || 'paper';
			await writeHashToAllLayers(hash, tier2Result.card_id!, tier2Result.confidence, workingBitmap, hashGameId, hashVariant);
			return finalize(tier2Result);
		}
	} else {
		console.debug('[scan] Tier 2 skipped: OCR not available');
		tier2Tel.attempted = false;
		tier2Tel.skipReason = 'ocr_unavailable';
		tier2Tel.outcome = 'skipped';
		void scanIdPromise.then((sid) => { if (sid) emitTier2Result(sid, tier2Tel); });
	}

	// ── TIER 3: Claude API ──────────────────────────────────
	// Anonymous users are allowed — server-side rate limit (5/60s per IP) protects against abuse
	onTierChange?.(3);
	console.debug('[scan] Starting Tier 3: Claude AI identification...');
	const tier3Result = await runTier3(workingBitmap, ctx, tier3Tel);
	void scanIdPromise.then((sid) => { if (sid) emitTier3Result(sid, tier3Tel); });
	if (tier3Result) {
		console.debug(`[scan] Tier 3 HIT: card_id=${tier3Result.card_id}, card=${tier3Result.card?.card_number}, confidence=${tier3Result.confidence}, game=${tier3Result.game_id ?? tier3Result.card?.game_id ?? gameHint}, variant=${tier3Result.variant}`);
		const hash = await getImageWorker().computeDHash(workingBitmap);
		const hashGameId = tier3Result.card?.game_id || tier3Result.game_id || gameHint || 'boba';
		// Tier 3 variant comes from Claude's decision-tree output. Default to
		// 'paper' only if null (e.g., BoBA cards where variant is baked into card_number).
		const hashVariant = tier3Result.variant || 'paper';
		await writeHashToAllLayers(hash, tier3Result.card_id!, tier3Result.confidence, workingBitmap, hashGameId, hashVariant);

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
	variant: string = 'paper'
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
		await idb.setHash({ phash: hash, card_id: cardId, confidence, game_id: gameId, variant, ...(phash256 ? { phash_256: phash256 } : {}) });
	} catch (err) {
		console.debug('[scan] IDB hash write failed:', err);
	}

	// Layer 3: Supabase (atomic scan_count increment via RPC)
	if (!_upsertHashRpcDisabled) {
		try {
			const client = getSupabase();
			if (client) {
				const rpcArgs: { p_phash: string; p_card_id: string; p_confidence: number; p_phash_256?: string; p_game_id: string; p_variant: string } = {
					p_phash: hash,
					p_card_id: cardId,
					p_confidence: confidence,
					p_game_id: gameId,
					p_variant: variant,
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

