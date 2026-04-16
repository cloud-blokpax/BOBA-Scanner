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
import { runTier1, runTier2, runTier3, type ScanContext } from './recognition-tiers';
import { incrementPersona } from './persona';

// Re-export for backward compatibility
export { analyzeFrame, checkImageQuality, computeFrameHash, computeHammingDistance, compositeForFoilMode, resetWorkerFailCount, initWorkers } from './recognition-workers';
export { disableFuzzyHashRpc, isFuzzyHashRpcDisabled } from './recognition-tiers';

/** Circuit breaker: disable upsert hash cache RPC for the session if it fails once */
let _upsertHashRpcDisabled = false;

/**
 * Persist a successful scan to Supabase for cross-device recent scans.
 * Non-blocking, best-effort — does not affect scan flow.
 */
async function logScanToSupabase(result: ScanResult): Promise<void> {
	const uid = userId();
	if (!uid || !result.card_id) return;

	const client = getSupabase();
	if (!client) return;

	try {
		const { error: scanError } = await client.from('scans').insert({
			user_id: uid,
			card_id: result.card_id,
			hero_name: result.card?.hero_name ?? null,
			card_number: result.card?.card_number ?? null,
			scan_method: result.scan_method ?? 'unknown',
			confidence: result.confidence ?? null,
			processing_ms: result.processing_ms ?? null,
			game_id: result.game_id || 'boba'
		});
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
		if (final.card_id) {
			logScanToSupabase(final);
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
	onTierChange?.(1);
	console.debug('[scan] Starting Tier 1: Hash Cache lookup...');
	try {
		const tier1Result = await runTier1(bitmap, ctx, writeHashToAllLayers);
		if (tier1Result) {
			console.debug(`[scan] Tier 1 HIT: card_id=${tier1Result.card_id}, card=${tier1Result.card?.card_number}, confidence=${tier1Result.confidence}`);
			return finalize(tier1Result);
		}
		console.debug('[scan] Tier 1 MISS: no hash match found');
	} catch (err) {
		console.warn(`[scan:${ctx.traceId}] Tier 1 failed, falling through:`, err);
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
		try {
			const tier2Result = await runTier2(bitmap, ctx);
			if (tier2Result) {
				console.debug(`[scan] Tier 2 HIT: card_id=${tier2Result.card_id}, card=${tier2Result.card?.card_number}, confidence=${tier2Result.confidence}, game=${tier2Result.game_id ?? tier2Result.card?.game_id ?? gameHint}`);
				const hash = await getImageWorker().computeDHash(bitmap);
				const hashGameId = tier2Result.card?.game_id || tier2Result.game_id || gameHint || 'boba';
				// Tier 2 can't detect variant visually. Default to 'paper' in the hash
				// cache — the Tier 2 confirmation UI forces the user to choose variant
				// before the collection entry is created, so the collection row records
				// the truth regardless of what the hash cache says.
				const hashVariant = tier2Result.variant || 'paper';
				await writeHashToAllLayers(hash, tier2Result.card_id!, tier2Result.confidence, bitmap, hashGameId, hashVariant);
				return finalize(tier2Result);
			}
			console.debug('[scan] Tier 2 MISS: OCR could not match a card number');
		} catch (err) {
			// OCR failure is non-fatal — fall through to Tier 3
			console.warn('[scan] Tier 2 error (falling through to Tier 3):', err);
		}
	} else {
		console.debug('[scan] Tier 2 skipped: OCR not available');
	}

	// ── TIER 3: Claude API ──────────────────────────────────
	// Anonymous users are allowed — server-side rate limit (5/60s per IP) protects against abuse
	onTierChange?.(3);
	console.debug('[scan] Starting Tier 3: Claude AI identification...');
	const tier3Result = await runTier3(bitmap, ctx);
	if (tier3Result) {
		console.debug(`[scan] Tier 3 HIT: card_id=${tier3Result.card_id}, card=${tier3Result.card?.card_number}, confidence=${tier3Result.confidence}, game=${tier3Result.game_id ?? tier3Result.card?.game_id ?? gameHint}, variant=${tier3Result.variant}`);
		const hash = await getImageWorker().computeDHash(bitmap);
		const hashGameId = tier3Result.card?.game_id || tier3Result.game_id || gameHint || 'boba';
		// Tier 3 variant comes from Claude's decision-tree output. Default to
		// 'paper' only if null (e.g., BoBA cards where variant is baked into card_number).
		const hashVariant = tier3Result.variant || 'paper';
		await writeHashToAllLayers(hash, tier3Result.card_id!, tier3Result.confidence, bitmap, hashGameId, hashVariant);

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

