/**
 * Three-Tier Recognition Pipeline
 *
 * Tier 1: Perceptual Hash (dHash) → IndexedDB → Supabase hash_cache
 * Tier 2: Tesseract.js OCR → Fuzzy match against local card DB
 * Tier 3: Claude API → Server-side identification
 *
 * Expected: 85-95% of scans resolved without Claude API calls.
 */

import * as Comlink from 'comlink';
import { idb } from './idb';
import { findCard, getCardById, loadCardDatabase, normalizeCardNum, getAllCards, searchCards, findSimilarCardNumbers } from './card-db';
import { getSupabase } from './supabase';

/** Circuit breaker: disable fuzzy hash RPC for the session if it fails once (bad DB function) */
export let _fuzzyHashRpcDisabled = false;
export function disableFuzzyHashRpc(): void { _fuzzyHashRpcDisabled = true; }
/** Circuit breaker: disable upsert hash cache RPC for the session if it fails once */
let _upsertHashRpcDisabled = false;
import { checkCorrection, recordCorrection, loadCorrectionsFromIdb } from '$lib/services/scan-learning';
import { initOcr, recognizeText, terminateOcr } from '$lib/services/ocr';
import { extractCardNumber } from '$lib/utils/extract-card-number';
import { trigramSimilarity, fuzzyNameMatch } from '$lib/utils/fuzzy-match';
import { getCardImageUrl } from '$lib/utils/image-url';
import { addToScanHistory } from '$lib/stores/scan-history.svelte';
import { trackScanMetric } from '$lib/services/error-tracking';
import { userId } from '$lib/stores/auth.svelte';
import { submitReferenceImage } from '$lib/services/reference-images';
import { BOBA_OCR_REGIONS, BOBA_SCAN_CONFIG, BOBA_PIPELINE_CONFIG } from '$lib/data/boba-config';
import type { Card, ScanResult, ScanMethod, HashCacheEntry, ValidationMethod } from '$lib/types';

/**
 * Create a small data-URL thumbnail from a bitmap for scan history display.
 * Produces a ~2-5KB JPEG suitable for IndexedDB/localStorage persistence.
 */
function createThumbnailDataUrl(bitmap: ImageBitmap): string | null {
	try {
		const MAX_W = 80;
		const MAX_H = 112;
		const scale = Math.min(MAX_W / bitmap.width, MAX_H / bitmap.height, 1);
		const w = Math.round(bitmap.width * scale);
		const h = Math.round(bitmap.height * scale);

		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;

		ctx.drawImage(bitmap, 0, 0, w, h);
		return canvas.toDataURL('image/jpeg', 0.6);
	} catch (err) {
		console.debug('[recognition] Thumbnail creation failed:', err);
		return null;
	}
}

// ── Worker instances ────────────────────────────────────────

let imageWorker: Comlink.Remote<{
	computeDHash: (bitmap: ImageBitmap, size?: number) => Promise<string>;
	computePHash: (bitmap: ImageBitmap, size?: number) => Promise<string>;
	hammingDistance: (a: string, b: string) => number;
	resizeForUpload: (bitmap: ImageBitmap, max?: number) => Promise<Blob>;
	checkBlurry: (bitmap: ImageBitmap, threshold?: number) => Promise<{ isBlurry: boolean; variance: number }>;
	checkGlare: (bitmap: ImageBitmap, brightnessThreshold?: number, areaThreshold?: number) => Promise<{ hasGlare: boolean; regions: Array<{ x: number; y: number; w: number; h: number }> }>;
	analyzeCardPresence: (bitmap: ImageBitmap, blurThreshold?: number) => Promise<{ cardDetected: boolean; isSharp: boolean; variance: number }>;
	preprocessForOCR: (bitmap: ImageBitmap, region: { x: number; y: number; w: number; h: number }) => Promise<Blob>;
	compositeMinPixel: (bitmaps: ImageBitmap[]) => Promise<ImageBitmap>;
}> | null = null;

/**
 * Per-scan context to avoid global state pollution when concurrent scans run.
 * Previously these were module-level variables that would be overwritten
 * by a second scan starting before the first one finishes.
 */
interface ScanContext {
	traceId: string;
	lastOcrReading: string | null;
	lastTier3FailReason: string | null;
}

/**
 * Analyze a video frame for card presence and sharpness (for auto-capture).
 */
export async function analyzeFrame(bitmap: ImageBitmap): Promise<{
	cardDetected: boolean;
	isSharp: boolean;
}> {
	await initWorkers();
	const result = await imageWorker!.analyzeCardPresence(bitmap, BOBA_SCAN_CONFIG.blurThreshold);
	return { cardDetected: result.cardDetected, isSharp: result.isSharp };
}

/**
 * Check image quality (blur + glare) before capture.
 * Returns null if quality is acceptable, or a reason string if not.
 */
export async function checkImageQuality(bitmap: ImageBitmap): Promise<{
	isBlurry: boolean;
	variance: number;
	hasGlare: boolean;
	glareRegions: Array<{ x: number; y: number; w: number; h: number }>;
}> {
	await initWorkers();
	const [blur, glare] = await Promise.all([
		imageWorker!.checkBlurry(bitmap, BOBA_SCAN_CONFIG.blurThreshold),
		imageWorker!.checkGlare(bitmap)
	]);
	return {
		isBlurry: blur.isBlurry,
		variance: blur.variance,
		hasGlare: glare.hasGlare,
		glareRegions: glare.regions
	};
}

/**
 * Compute a quick frame hash for stability detection (not card matching).
 * Used by Scanner.svelte to detect frame-to-frame stability before auto-capture.
 */
export async function computeFrameHash(bitmap: ImageBitmap): Promise<string> {
	await initWorkers();
	return imageWorker!.computeDHash(bitmap, 8);
}

/**
 * Compute Hamming distance between two hex hash strings.
 * Exposed for Scanner.svelte stability detection.
 */
export async function computeHammingDistance(a: string, b: string): Promise<number> {
	await initWorkers();
	return imageWorker!.hammingDistance(a, b);
}

/**
 * Composite multiple captures using darkest-pixel selection (for foil mode).
 * Runs in the web worker off the main thread.
 */
export async function compositeForFoilMode(bitmaps: ImageBitmap[]): Promise<ImageBitmap> {
	await initWorkers();
	return imageWorker!.compositeMinPixel(bitmaps);
}

/**
 * Initialize the Web Workers. Call once on app start.
 * Uses a shared promise to prevent duplicate Worker creation from concurrent calls.
 */
let _workerInitPromise: Promise<void> | null = null;
let _ocrAvailable = false;
let _ocrRetryAttempted = false;
let _initFailCount = 0;
const MAX_INIT_RETRIES = 3;

/** Reset the worker failure counter so navigation acts as a retry. */
export function resetWorkerFailCount(): void {
	_initFailCount = 0;
}

export async function initWorkers(): Promise<void> {
	if (imageWorker) return;
	if (_initFailCount >= MAX_INIT_RETRIES) {
		throw new Error('Image worker failed to initialize after multiple attempts. Please reload the page.');
	}
	// Return existing in-flight promise to prevent duplicate Worker creation
	// from concurrent calls (e.g., batch/binder scanning).
	if (_workerInitPromise) return _workerInitPromise;

	_workerInitPromise = (async () => {
		// Double-check after acquiring the "lock" — another call may have
		// resolved between our first check and promise assignment.
		if (!imageWorker) {
			try {
				const ImageWorker = new Worker(
					new URL('$lib/workers/image-processor.ts', import.meta.url),
					{ type: 'module' }
				);
				imageWorker = Comlink.wrap(ImageWorker);
			} catch (err) {
				imageWorker = null;
				console.error('[scan] Worker constructor failed:', err);
				throw err;
			}
		}

		// Eagerly load OCR corrections into memory for synchronous lookups
		loadCorrectionsFromIdb().catch((err) => console.warn('[scan] Failed to load OCR corrections from IDB:', err));

		// Initialize Tesseract OCR with a timeout — if it fails, Tier 2 is
		// skipped gracefully and we fall through to Tier 3 (Claude API).
		try {
			await Promise.race([
				initOcr(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('OCR init timed out')), 15000)
				)
			]);
			_ocrAvailable = true;
			console.debug('[scan] Tesseract OCR initialized successfully');
		} catch (err) {
			_ocrAvailable = false;
			console.warn('[scan] Tesseract OCR failed to initialize — Tier 2 disabled:', err);
		}
	})();

	try {
		await _workerInitPromise;
		_initFailCount = 0;
	} catch (err) {
		_initFailCount++;
		_workerInitPromise = null;
		throw err;
	}
}

/**
 * Run the full 3-tier recognition pipeline.
 *
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
		await client.from('scans').insert({
			user_id: uid,
			card_id: result.card_id,
			hero_name: result.card?.hero_name ?? null,
			card_number: result.card?.card_number ?? null,
			scan_method: result.scan_method ?? 'unknown',
			confidence: result.confidence ?? null,
			processing_ms: result.processing_ms ?? null
		});
	} catch (err) {
		console.debug('[scan] Supabase scan log failed:', err);
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
	options?: { isAuthenticated?: boolean; skipBlurCheck?: boolean }
): Promise<ScanResult> {
	const traceId = crypto.randomUUID().slice(0, 8);
	const startTime = performance.now();
	await initWorkers();
	const loadedCards = await loadCardDatabase();

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

	console.debug(`[scan:${traceId}] Pipeline started. ${loadedCards.length} cards loaded.`);

	// Per-scan context to avoid global state pollution across concurrent scans
	const ctx: ScanContext = { traceId, lastOcrReading: null, lastTier3FailReason: null };

	// Convert to ImageBitmap for worker transfer
	const bitmap =
		imageSource instanceof ImageBitmap
			? imageSource
			: await createImageBitmap(imageSource);

	// ── Check blur (skip if caller already verified quality) ─
	if (!options?.skipBlurCheck) {
		const blurResult = await imageWorker!.checkBlurry(bitmap, BOBA_SCAN_CONFIG.blurThreshold);
		console.debug(`[scan] Blur check: variance=${blurResult.variance.toFixed(1)}, threshold=${BOBA_SCAN_CONFIG.blurThreshold}, isBlurry=${blurResult.isBlurry}`);
		if (blurResult.isBlurry) {
			console.warn(`[scan] Image rejected as blurry (variance ${blurResult.variance.toFixed(1)} < ${BOBA_SCAN_CONFIG.blurThreshold})`);
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
		const final = { ...result, processing_ms: Math.round(performance.now() - startTime), traceId };
		// Create a persistent thumbnail from the scanned bitmap for scan history display.
		// This replaces the previous getCardImageUrl() call which pointed to non-existent
		// reference images in Supabase Storage.
		const thumbnail = bitmap instanceof ImageBitmap ? createThumbnailDataUrl(bitmap) : null;
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
			negativeCacheHit: final.failReason?.includes('not yet in database') ?? false
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
		const tier1Result = await runTier1(bitmap, ctx);
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
		const { scanQueue } = await import('./idb');
		const imageBlob = imageSource instanceof Blob
			? imageSource
			: await imageWorker!.resizeForUpload(bitmap, 1024);
		await scanQueue.add(imageBlob);
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
	if (!_ocrAvailable && !_ocrRetryAttempted && navigator.onLine) {
		_ocrRetryAttempted = true;
		try {
			await Promise.race([
				initOcr(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('OCR retry timed out')), 10000)
				)
			]);
			_ocrAvailable = true;
			console.debug('[scan] Tesseract OCR initialized on retry');
		} catch (err) {
			console.warn('[scan] Tesseract OCR retry failed — Tier 2 remains disabled:', err);
		}
	}

	if (_ocrAvailable) {
		onTierChange?.(2);
		console.debug('[scan] Starting Tier 2: OCR card number extraction...');
		try {
			const tier2Result = await runTier2(bitmap, ctx);
			if (tier2Result) {
				console.debug(`[scan] Tier 2 HIT: card_id=${tier2Result.card_id}, card=${tier2Result.card?.card_number}, confidence=${tier2Result.confidence}`);
				const hash = await imageWorker!.computeDHash(bitmap);
				await writeHashToAllLayers(hash, tier2Result.card_id!, tier2Result.confidence, bitmap);
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
		console.debug(`[scan] Tier 3 HIT: card_id=${tier3Result.card_id}, card=${tier3Result.card?.card_number}, confidence=${tier3Result.confidence}`);
		const hash = await imageWorker!.computeDHash(bitmap);
		await writeHashToAllLayers(hash, tier3Result.card_id!, tier3Result.confidence, bitmap);

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

// ── Tier 1: Hash Cache Lookup ───────────────────────────────

async function runTier1(bitmap: ImageBitmap, ctx: ScanContext): Promise<ScanResult | null> {
	const hash = await imageWorker!.computeDHash(bitmap);

	// Layer 1: IndexedDB exact match (instant, free)
	const idbEntry = await idb.getHash(hash) as Pick<HashCacheEntry, 'card_id' | 'confidence'> | undefined;
	if (idbEntry) {
		// Detect negative cache entries (card recognized but not in database)
		if (idbEntry.card_id.startsWith('__unrecognized:')) {
			const cardNum = idbEntry.card_id.replace('__unrecognized:', '');
			return {
				card_id: null,
				card: null,
				scan_method: 'hash_cache' as ScanMethod,
				confidence: 0,
				processing_ms: 0,
				failReason: `Card "${cardNum}" recognized but not yet in database`
			};
		}
		const card = getCardById(idbEntry.card_id) || await fetchCardById(idbEntry.card_id);
		if (card) {
			return {
				card_id: card.id,
				card,
				scan_method: 'hash_cache',
				confidence: idbEntry.confidence,
				processing_ms: 0
			};
		}
	}

	// Layer 2: Supabase exact match (origin, <100ms)
	const client = getSupabase();
	let supaEntry: Pick<HashCacheEntry, 'card_id' | 'confidence'> | null = null;
	if (client) {
		const { data } = await client
			.from('hash_cache')
			.select('card_id, confidence')
			.eq('phash', hash)
			.maybeSingle();
		supaEntry = data as Pick<HashCacheEntry, 'card_id' | 'confidence'> | null;
	}

	if (supaEntry) {
		const card = getCardById(supaEntry.card_id) || await fetchCardById(supaEntry.card_id);
		if (card) {
			await idb.setHash({ phash: hash, card_id: supaEntry.card_id, confidence: supaEntry.confidence });
			return {
				card_id: card.id,
				card,
				scan_method: 'hash_cache' as const,
				confidence: supaEntry.confidence,
				processing_ms: 0
			};
		}
	}

	// Layer 3: Supabase fuzzy match via Hamming distance (≤5 bits different)
	// This catches the same card under different lighting conditions.
	if (client && !_fuzzyHashRpcDisabled && /^[0-9a-f]{16}$/.test(hash)) {
		try {
			const { data: fuzzyMatch, error: fuzzyErr } = await client.rpc('find_similar_hash', {
				query_hash: hash,
				max_distance: 5
			});
			if (fuzzyErr) {
				console.debug(`[scan:${ctx.traceId}:tier1] Fuzzy hash lookup RPC error:`, fuzzyErr.message);
				// Disable for rest of session to avoid repeated 400 errors
				_fuzzyHashRpcDisabled = true;
			} else if (fuzzyMatch && fuzzyMatch.length > 0) {
				const match = fuzzyMatch[0];

				// pHash verification: if the fuzzy match has a pHash stored,
				// compute our pHash and compare to reduce false positives
				let pHashVerified = true;
				if (match.phash_256) {
					try {
						const queryPHash = await imageWorker!.computePHash(bitmap, 16);
						const pHashDist = await imageWorker!.hammingDistance(queryPHash, match.phash_256);
						// pHash threshold: 256-bit hash, allow up to 20 bits different
						pHashVerified = pHashDist <= 20;
						if (!pHashVerified) {
							console.debug(`[scan:${ctx.traceId}:tier1] Fuzzy dHash match rejected by pHash verification (pHash distance=${pHashDist})`);
						}
					} catch (err) {
						console.debug(`[scan:${ctx.traceId}:tier1] pHash computation failed, trusting dHash:`, err);
						pHashVerified = true;
					}
				}

				if (pHashVerified) {
					const card = getCardById(match.card_id) || await fetchCardById(match.card_id);
					if (card) {
						// Reduce confidence slightly based on distance (5 bits = ~8% penalty)
						const adjustedConfidence = match.confidence * (1 - match.distance * 0.015);
						// Cache the new hash → same card for future exact matches
						await writeHashToAllLayers(hash, match.card_id, adjustedConfidence, bitmap);
						console.debug(`[scan:${ctx.traceId}:tier1] Fuzzy hash match: distance=${match.distance}, card=${card.card_number}`);
						return {
							card_id: card.id,
							card,
							scan_method: 'hash_cache' as const,
							confidence: adjustedConfidence,
							processing_ms: 0
						};
					}
				}
			}
		} catch (err) {
			// Fuzzy match is non-critical — if the RPC doesn't exist yet, skip
			console.debug(`[scan:${ctx.traceId}:tier1] Fuzzy hash lookup unavailable:`, err);
		}
	}

	return null;
}

// ── Tier 2: OCR + Fuzzy Match ───────────────────────────────

/** Race a promise against a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
		)
	]);
}

async function runTier2(bitmap: ImageBitmap, ctx: ScanContext): Promise<ScanResult | null> {
	const TIER2_BUDGET_MS = 12000; // 12 seconds total for all OCR attempts
	const tier2Start = performance.now();

	for (const region of BOBA_OCR_REGIONS) {
		const elapsed = performance.now() - tier2Start;
		const remaining = TIER2_BUDGET_MS - elapsed;
		if (remaining <= 1000) {
			console.debug(`[scan:${ctx.traceId}:tier2] Budget exhausted after ${elapsed.toFixed(0)}ms, skipping remaining regions`);
			break;
		}

		try {
			// Preprocess region in image worker
			const processedBlob = await withTimeout(
				imageWorker!.preprocessForOCR(bitmap, region),
				Math.min(3000, remaining), 'OCR preprocess'
			);

			// Run OCR (Tesseract manages its own worker internally)
			const ocrResult = await withTimeout(
				recognizeText(processedBlob),
				Math.min(8000, remaining - 3000), 'OCR recognition'
			);
			if (ocrResult.confidence < BOBA_SCAN_CONFIG.ocrConfidenceThreshold) continue;

			// Extract card number
			const resolvedNumber = extractCardNumber(ocrResult.text);
			if (!resolvedNumber) continue;

			// Track the raw OCR reading for potential correction recording
			ctx.lastOcrReading = resolvedNumber;

			// Check local learned correction first (instant, offline-capable)
			let correctedNumber = checkCorrection(resolvedNumber);

			// If no local correction, check community corrections (requires network)
			if (!correctedNumber) {
				try {
					const { lookupCommunityCorrection } = await import('$lib/services/community-corrections');
					correctedNumber = await lookupCommunityCorrection(resolvedNumber);
				} catch (err) {
					console.debug(`[scan:${ctx.traceId}:tier2] Community correction lookup failed:`, err);
				}
			}

			const lookupNumber = correctedNumber || resolvedNumber;

			const card = findCard(lookupNumber);
			if (card) {
				return {
					card_id: card.id,
					card,
					scan_method: 'tesseract' as ScanMethod,
					confidence: correctedNumber ? 0.95 : ocrResult.confidence / 100,
					processing_ms: 0
				};
			}
		} catch (err) {
			console.warn('OCR region failed:', err);
		}
	}

	return null;
}

// ── Tier 3: Claude API ──────────────────────────────────────

async function runTier3(bitmap: ImageBitmap, ctx: ScanContext): Promise<ScanResult | null> {
	ctx.lastTier3FailReason = null;
	let response: Response;
	try {
		// Resize for upload
		const imageBlob = await imageWorker!.resizeForUpload(bitmap, 1024);
		console.debug(`[scan:${ctx.traceId}:tier3] Image resized for upload: ${(imageBlob.size / 1024).toFixed(1)}KB`);

		const formData = new FormData();
		formData.append('image', imageBlob, 'scan.jpg');

		response = await fetch('/api/scan', {
			method: 'POST',
			body: formData
		});
	} catch (err) {
		console.error(`[scan:${ctx.traceId}:tier3] Network error calling /api/scan:`, err);
		ctx.lastTier3FailReason = 'Network error reaching scan API';
		return null;
	}

	if (!response.ok) {
		let errorBody = '';
		try { errorBody = await response.text(); } catch { /* ignore */ }
		console.error(`[scan:${ctx.traceId}:tier3] API returned ${response.status}: ${errorBody}`);
		if (response.status === 401) ctx.lastTier3FailReason = 'Not authenticated — please sign in';
		else if (response.status === 429) ctx.lastTier3FailReason = 'Rate limited — please wait before scanning again';
		else if (response.status === 503) ctx.lastTier3FailReason = 'AI service overloaded — try again in a moment';
		else ctx.lastTier3FailReason = `Scan API error (${response.status})`;
		return null;
	}

	let result;
	try {
		result = await response.json();
	} catch (err) {
		console.debug(`[scan:${ctx.traceId}:tier3] API response JSON parse failed:`, err);
		console.error(`[scan:${ctx.traceId}:tier3] Invalid JSON in API response`);
		ctx.lastTier3FailReason = 'Invalid response from scan API';
		return null;
	}

	console.debug(`[scan:${ctx.traceId}:tier3] API response:`, JSON.stringify(result, null, 2));

	if (!result.success || !result.card) {
		console.warn(`[scan:${ctx.traceId}:tier3] API returned success=false or no card data. Raw:`, result.raw || '(none)');
		ctx.lastTier3FailReason = 'AI could not parse card details from image';
		return null;
	}

	const claudeHero = result.card.hero_name || result.card.card_name || null;
	const claudeNumber = result.card.card_number;
	const claudePower = result.card.power ? Number(result.card.power) : null;
	console.debug(`[scan:${ctx.traceId}:tier3] Claude identified: card_number="${claudeNumber}", hero="${claudeHero}", power=${claudePower}, confidence=${result.card.confidence}`);

	// ── Cross-validation: card_number is primary key, hero_name is verification ──
	const validated = crossValidateCardResult(
		{ cardNumber: claudeNumber, heroName: claudeHero, power: claudePower, confidence: result.card.confidence || 0.9 },
		ctx.traceId
	);

	if (validated.card) {
		console.debug(
			`[scan:${ctx.traceId}:tier3] Validated: id=${validated.card.id}, number=${validated.card.card_number}, ` +
			`method=${validated.validationMethod}, confidence=${validated.confidence}`
		);
		if (validated.warnings.length > 0) {
			console.warn(`[scan:${ctx.traceId}:tier3] Validation warnings:`, validated.warnings);
		}
		return {
			card_id: validated.card.id,
			card: validated.card,
			scan_method: 'claude',
			confidence: validated.confidence,
			processing_ms: 0,
			variant: result.card.variant || result.card.parallel || null,
			validationMethod: validated.validationMethod,
			validationWarnings: validated.warnings
		};
	}

	console.warn(`[scan:${ctx.traceId}:tier3] Claude identified card_number="${claudeNumber}" hero="${claudeHero}" but NO MATCH in local card database (${getAllCards().length} cards loaded)`);
	ctx.lastTier3FailReason = `AI identified "${claudeNumber}" (${claudeHero}) but card not found in database`;

	// Negative cache: prevent repeated Tier 3 calls for unrecognized cards
	if (claudeNumber) {
		try {
			const hash = await imageWorker!.computeDHash(bitmap);
			await idb.setHash({
				phash: hash,
				card_id: `__unrecognized:${claudeNumber}`,
				confidence: 0
			});
		} catch (err) {
			console.debug(`[scan:${ctx.traceId}:tier3] Failed to write negative cache entry:`, err);
		}
	}

	return null;
}

/**
 * Cross-validate AI-returned card data against the local card database.
 *
 * Flow:
 *   1. Exact match card_number → verify hero name matches
 *   2. Fuzzy match card_number → verify hero name matches
 *   3. Fallback: search by hero name + power
 *   4. No match
 *
 * The card number is the primary key; the hero name is the validation check.
 */
interface CrossValidationInput {
	cardNumber: string | null;
	heroName: string | null;
	power: number | null;
	confidence: number;
}

interface CrossValidationResult {
	card: Card | null;
	confidence: number;
	validationMethod: ValidationMethod;
	warnings: string[];
}

function crossValidateCardResult(
	ai: CrossValidationInput,
	traceId: string
): CrossValidationResult {
	const warnings: string[] = [];
	const allCards = getAllCards();

	// ── Step 1: Exact match on card_number ──
	if (ai.cardNumber) {
		const exactMatch = findCard(ai.cardNumber);
		if (exactMatch) {
			// Verify hero name matches
			const nameScore = ai.heroName
				? fuzzyNameMatch(exactMatch.hero_name || exactMatch.name || '', ai.heroName)
				: 1; // No hero name from AI → skip verification

			if (nameScore > 0.7) {
				// Card number found and hero name agrees → HIGH CONFIDENCE
				return {
					card: exactMatch,
					confidence: ai.confidence,
					validationMethod: 'exact_match',
					warnings: []
				};
			}

			// Card number exists but hero name doesn't match → AI may have misread the number
			warnings.push(
				`Card number "${ai.cardNumber}" exists as "${exactMatch.hero_name || exactMatch.name}" ` +
				`but AI read hero as "${ai.heroName}". Possible card number misread.`
			);
			console.debug(
				`[scan:${traceId}:validate] Exact number match rejected: ` +
				`DB hero="${exactMatch.hero_name}" vs AI hero="${ai.heroName}" (score=${nameScore.toFixed(2)})`
			);
			// Fall through to fuzzy match — don't trust this card number
		}

		// ── Step 2: Fuzzy match on card_number ──
		const fuzzyResults = findSimilarCardNumbers(ai.cardNumber, 2);
		for (const match of fuzzyResults) {
			if (!ai.heroName) {
				// No hero name to verify — accept best fuzzy match with reduced confidence
				return {
					card: match.card,
					confidence: Math.min(ai.confidence, 0.65),
					validationMethod: 'fuzzy_match',
					warnings: [
						`Fuzzy matched card number: AI read "${ai.cardNumber}", ` +
						`matched to "${match.card.card_number}" (distance: ${match.distance})`
					]
				};
			}

			const nameScore = fuzzyNameMatch(
				match.card.hero_name || match.card.name || '',
				ai.heroName
			);

			if (nameScore > 0.7) {
				// Fuzzy number match + hero name agrees → MEDIUM CONFIDENCE
				return {
					card: match.card,
					confidence: Math.min(ai.confidence, 0.75),
					validationMethod: 'fuzzy_match',
					warnings: [
						`Fuzzy matched card number: AI read "${ai.cardNumber}", ` +
						`matched to "${match.card.card_number}" (distance: ${match.distance})`
					]
				};
			}
		}

		// Also try trigram similarity for card numbers that differ more from known prefixes
		if (fuzzyResults.length === 0) {
			let bestTrigram: { card: Card; similarity: number } | null = null;
			for (const card of allCards) {
				if (!card.card_number) continue;
				const sim = trigramSimilarity(card.card_number, ai.cardNumber);
				if (sim > 0.6 && (!bestTrigram || sim > bestTrigram.similarity)) {
					// Verify hero name before accepting
					if (ai.heroName) {
						const nameScore = fuzzyNameMatch(
							card.hero_name || card.name || '',
							ai.heroName
						);
						if (nameScore > 0.7) {
							bestTrigram = { card, similarity: sim };
						}
					} else {
						bestTrigram = { card, similarity: sim };
					}
				}
			}

			if (bestTrigram) {
				return {
					card: bestTrigram.card,
					confidence: Math.min(ai.confidence, 0.7),
					validationMethod: 'fuzzy_match',
					warnings: [
						`Trigram matched card number: AI read "${ai.cardNumber}", ` +
						`matched to "${bestTrigram.card.card_number}" (similarity: ${bestTrigram.similarity.toFixed(2)})`
					]
				};
			}
		}
	}

	// ── Step 3: Fallback — search by hero name (+ power to disambiguate) ──
	if (ai.heroName) {
		const heroSearchResults = searchCards(ai.heroName, 10);

		if (heroSearchResults.length > 0) {
			// If we have power info, use it to disambiguate among hero matches
			if (ai.power && heroSearchResults.length > 1) {
				const powerMatch = heroSearchResults.find(c => c.power === ai.power);
				if (powerMatch) {
					warnings.push(
						`Could not validate card number "${ai.cardNumber ?? '(null)'}". ` +
						`Matched by hero name "${ai.heroName}" + power=${ai.power} → "${powerMatch.card_number}".`
					);
					return {
						card: powerMatch,
						confidence: Math.min(ai.confidence, 0.6),
						validationMethod: 'name_only_fallback',
						warnings
					};
				}
			}

			// Take the first hero match (lowest confidence)
			const bestMatch = heroSearchResults[0];
			warnings.push(
				`Could not validate card number "${ai.cardNumber ?? '(null)'}". ` +
				`Matched by hero name "${ai.heroName}" → "${bestMatch.card_number}". ` +
				`Card number may be incorrect — please verify.`
			);

			if (heroSearchResults.length > 1) {
				warnings.push(
					`Multiple variants found for "${ai.heroName}". User should verify card number.`
				);
			}

			return {
				card: bestMatch,
				confidence: Math.min(ai.confidence, 0.5),
				validationMethod: 'name_only_fallback',
				warnings
			};
		}
	}

	// ── Step 4: No match at all ──
	return {
		card: null,
		confidence: 0,
		validationMethod: 'unvalidated',
		warnings: [
			`Card not found in database. Number: "${ai.cardNumber ?? '(null)'}", ` +
			`Name: "${ai.heroName ?? '(null)'}". May be a new/unreleased card or misread.`
		]
	};
}

// ── Cache Writeback ─────────────────────────────────────────

async function writeHashToAllLayers(
	hash: string,
	cardId: string,
	confidence: number,
	bitmap?: ImageBitmap
): Promise<void> {
	// Compute pHash if bitmap is available (for enhanced matching)
	let phash256: string | null = null;
	if (bitmap && imageWorker) {
		try {
			phash256 = await imageWorker.computePHash(bitmap, 16);
		} catch (err) {
			console.debug('[scan] pHash computation failed:', err);
		}
	}

	// Layer 1: IndexedDB
	try {
		await idb.setHash({ phash: hash, card_id: cardId, confidence, ...(phash256 ? { phash_256: phash256 } : {}) });
	} catch (err) {
		console.debug('[scan] IDB hash write failed:', err);
	}

	// Layer 3: Supabase (atomic scan_count increment via RPC)
	if (!_upsertHashRpcDisabled) {
		try {
			const client = getSupabase();
			if (client) {
				const rpcArgs: { p_phash: string; p_card_id: string; p_confidence: number; p_phash_256?: string } = {
					p_phash: hash,
					p_card_id: cardId,
					p_confidence: confidence
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
	if (bitmap && imageWorker && confidence >= BOBA_PIPELINE_CONFIG.referenceImageMinConfidence) {
		try {
			// Do bitmap operations NOW, before the caller closes the bitmap
			const uploadBlob = await imageWorker.resizeForUpload(bitmap, 800);
			const { variance: blurVariance } = await imageWorker.checkBlurry(bitmap, 100);

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

// ── Helpers ─────────────────────────────────────────────────

async function fetchCardById(cardId: string): Promise<Card | null> {
	const client = getSupabase();
	if (!client) return null;
	const { data } = await client.from('cards').select('*').eq('id', cardId).maybeSingle();
	// Runtime guard: ensure the critical fields exist before trusting the cast
	if (!data || typeof (data as Record<string, unknown>).id !== 'string') return null;
	return data as Card;
}
