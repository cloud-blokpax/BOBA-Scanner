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
import { findCard, getCardById, loadCardDatabase, normalizeCardNum, getAllCards } from './card-db';
import { getSupabase } from './supabase';
import { checkCorrection, recordCorrection } from '$lib/services/scan-learning';
import { initOcr, recognizeText, terminateOcr } from '$lib/services/ocr';
import { extractCardNumber } from '$lib/utils/extract-card-number';
import { addToScanHistory } from '$lib/stores/scan-history';
import { BOBA_OCR_REGIONS, BOBA_SCAN_CONFIG } from '$lib/data/boba-config';
import type { Card, ScanResult, ScanMethod, HashCacheEntry } from '$lib/types';

// ── Worker instances ────────────────────────────────────────

let imageWorker: Comlink.Remote<{
	computeDHash: (bitmap: ImageBitmap, size?: number) => Promise<string>;
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

export async function initWorkers(): Promise<void> {
	if (imageWorker) return;
	if (_workerInitPromise) return _workerInitPromise;

	_workerInitPromise = (async () => {
		if (!imageWorker) {
			const ImageWorker = new Worker(
				new URL('$lib/workers/image-processor.ts', import.meta.url),
				{ type: 'module' }
			);
			imageWorker = Comlink.wrap(ImageWorker);
		}
		// TODO: Tesseract is currently disabled — skip initialization
		// await initOcr();
	})();

	try {
		await _workerInitPromise;
	} finally {
		_workerInitPromise = null;
	}
}

/**
 * Run the full 3-tier recognition pipeline.
 *
 * @param imageSource - File, Blob, or ImageBitmap to scan
 * @param onTierChange - Optional callback for UI progress updates
 * @returns ScanResult with matched card data
 */
export async function recognizeCard(
	imageSource: File | Blob | ImageBitmap,
	onTierChange?: (tier: 1 | 2 | 3) => void,
	options?: { isAuthenticated?: boolean; skipBlurCheck?: boolean }
): Promise<ScanResult> {
	const startTime = performance.now();
	await initWorkers();
	const loadedCards = await loadCardDatabase();
	console.debug(`[scan] Pipeline started. Card database: ${loadedCards.length} cards loaded.`);

	// Per-scan context to avoid global state pollution across concurrent scans
	const ctx: ScanContext = { lastOcrReading: null, lastTier3FailReason: null };

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
				failReason: `Image too blurry (sharpness: ${blurResult.variance.toFixed(0)}/${BOBA_SCAN_CONFIG.blurThreshold})`
			};
		}
	}

	// Helper to record scan result to history and auto-tag before returning
	function finalize(result: ScanResult): ScanResult {
		const final = { ...result, processing_ms: Math.round(performance.now() - startTime) };
		addToScanHistory({
			cardNumber: final.card?.card_number ?? null,
			heroName: final.card?.hero_name ?? null,
			method: final.scan_method || 'unknown',
			confidence: final.confidence,
			success: final.card_id !== null,
			processingMs: final.processing_ms
		});

		// Auto-tag card with its parallel name
		if (final.card?.parallel && final.card_id) {
			import('$lib/stores/tags').then(({ addTag }) => {
				addTag(final.card_id!, final.card!.parallel!);
			}).catch(() => {});
		}

		return final;
	}

	// ── TIER 1: Perceptual Hash Lookup ──────────────────────
	onTierChange?.(1);
	console.debug('[scan] Starting Tier 1: Hash Cache lookup...');
	const tier1Result = await runTier1(bitmap);
	if (tier1Result) {
		console.debug(`[scan] Tier 1 HIT: card_id=${tier1Result.card_id}, card=${tier1Result.card?.card_number}, confidence=${tier1Result.confidence}`);
		return finalize(tier1Result);
	}
	console.debug('[scan] Tier 1 MISS: no hash match found');

	// ── TIER 2: OCR + Fuzzy Match (DISABLED — Tesseract not working) ──
	// TODO: Re-enable once Tesseract issues are resolved
	// onTierChange?.(2);
	// const tier2Result = await runTier2(bitmap);
	// if (tier2Result) {
	// 	const hash = await imageWorker!.computeDHash(bitmap);
	// 	await writeHashToAllLayers(hash, tier2Result.card_id!, tier2Result.confidence);
	// 	return finalize(tier2Result);
	// }

	// ── TIER 3: Claude API ──────────────────────────────────
	// Anonymous users are allowed — server-side rate limit (5/60s per IP) protects against abuse
	onTierChange?.(3);
	console.debug('[scan] Starting Tier 3: Claude AI identification...');
	const tier3Result = await runTier3(bitmap, ctx);
	if (tier3Result) {
		console.debug(`[scan] Tier 3 HIT: card_id=${tier3Result.card_id}, card=${tier3Result.card?.card_number}, confidence=${tier3Result.confidence}`);
		const hash = await imageWorker!.computeDHash(bitmap);
		await writeHashToAllLayers(hash, tier3Result.card_id!, tier3Result.confidence);

		// Record correction: Tier 2 read something but couldn't match; Tier 3 found the right card.
		// TODO: Re-enable when Tesseract is fixed — lastOcrReading is never set while OCR is disabled
		// if (tier3Result.card_id && tier3Result.card?.card_number && ctx.lastOcrReading) {
		// 	recordCorrection(ctx.lastOcrReading, tier3Result.card.card_number, 'ai');
		// }
		return finalize(tier3Result);
	}
	console.warn('[scan] Tier 3 MISS: Claude could not identify card (see earlier logs for details)');
	return finalize(
		{ card_id: null, card: null, scan_method: 'claude' as ScanMethod, confidence: 0, processing_ms: Math.round(performance.now() - startTime), failReason: ctx.lastTier3FailReason || 'AI could not identify this card' }
	);
}

// ── Tier 1: Hash Cache Lookup ───────────────────────────────

async function runTier1(bitmap: ImageBitmap): Promise<ScanResult | null> {
	const hash = await imageWorker!.computeDHash(bitmap);

	// Layer 1: IndexedDB (instant, free)
	const idbEntry = await idb.getHash(hash) as Pick<HashCacheEntry, 'card_id' | 'confidence'> | undefined;
	if (idbEntry) {
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

	// Layer 2: Supabase hash_cache (origin, <100ms)
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
			// Write back to IDB for next time
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
	for (const region of BOBA_OCR_REGIONS) {
		try {
			// Preprocess region in image worker
			const processedBlob = await withTimeout(
				imageWorker!.preprocessForOCR(bitmap, region),
				5000, 'OCR preprocess'
			);

			// Run OCR (Tesseract manages its own worker internally, timeout at 10s per region)
			const ocrResult = await withTimeout(
				recognizeText(processedBlob),
				10000, 'OCR recognition'
			);
			if (ocrResult.confidence < BOBA_SCAN_CONFIG.ocrConfidenceThreshold) continue;

			// Extract card number
			const resolvedNumber = extractCardNumber(ocrResult.text);
			if (!resolvedNumber) continue;

			// Track the raw OCR reading for potential correction recording
			ctx.lastOcrReading = resolvedNumber;

			// Check if we have a learned correction for this OCR output
			const correctedNumber = checkCorrection(resolvedNumber);
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
		console.debug(`[scan:tier3] Image resized for upload: ${(imageBlob.size / 1024).toFixed(1)}KB`);

		const formData = new FormData();
		formData.append('image', imageBlob, 'scan.jpg');

		response = await fetch('/api/scan', {
			method: 'POST',
			body: formData
		});
	} catch (err) {
		console.error('[scan:tier3] Network error calling /api/scan:', err);
		ctx.lastTier3FailReason = 'Network error reaching scan API';
		return null;
	}

	if (!response.ok) {
		let errorBody = '';
		try { errorBody = await response.text(); } catch { /* ignore */ }
		console.error(`[scan:tier3] API returned ${response.status}: ${errorBody}`);
		if (response.status === 401) ctx.lastTier3FailReason = 'Not authenticated — please sign in';
		else if (response.status === 429) ctx.lastTier3FailReason = 'Rate limited — please wait before scanning again';
		else if (response.status === 503) ctx.lastTier3FailReason = 'AI service overloaded — try again in a moment';
		else ctx.lastTier3FailReason = `Scan API error (${response.status})`;
		return null;
	}

	let result;
	try {
		result = await response.json();
	} catch {
		console.error('[scan:tier3] Invalid JSON in API response');
		ctx.lastTier3FailReason = 'Invalid response from scan API';
		return null;
	}

	console.debug('[scan:tier3] API response:', JSON.stringify(result, null, 2));

	if (!result.success || !result.card) {
		console.warn('[scan:tier3] API returned success=false or no card data. Raw:', result.raw || '(none)');
		ctx.lastTier3FailReason = 'AI could not parse card details from image';
		return null;
	}

	console.debug(`[scan:tier3] Claude identified: card_number="${result.card.card_number}", hero="${result.card.hero_name}", confidence=${result.card.confidence}`);

	// Match Claude response to local card database (hero-verified)
	const claudeHero = result.card.hero_name || result.card.card_name || null;
	const claudeNumber = result.card.card_number;
	const card = findCard(claudeNumber, claudeHero);

	if (card) {
		// Cross-verify: ensure the matched card's hero aligns with Claude's identification
		const matchedHero = (card.hero_name || card.name || '').toUpperCase();
		const expectedHero = (claudeHero || '').toUpperCase();
		let confidence = result.card.confidence || 0.9;

		if (expectedHero && matchedHero && expectedHero !== matchedHero) {
			// Partial match check (e.g. "AIR JORDAN" contains "AIR JORDAN")
			const isPartialMatch = matchedHero.includes(expectedHero) || expectedHero.includes(matchedHero);
			if (!isPartialMatch) {
				console.warn(
					`[scan:tier3] Hero mismatch after findCard: Claude said "${claudeHero}" ` +
					`but matched card has hero="${card.hero_name}", name="${card.name}". ` +
					`Reducing confidence.`
				);
				confidence = Math.min(confidence, 0.5);
			}
		}

		console.debug(`[scan:tier3] Matched to local DB: id=${card.id}, number=${card.card_number}, hero="${card.hero_name}", confidence=${confidence}`);
		return {
			card_id: card.id,
			card,
			scan_method: 'claude',
			confidence,
			processing_ms: 0,
			variant: result.card.variant || result.card.parallel || null
		};
	}

	console.warn(`[scan:tier3] Claude identified card_number="${claudeNumber}" hero="${claudeHero}" but NO MATCH in local card database (${getAllCards().length} cards loaded)`);
	ctx.lastTier3FailReason = `AI identified "${claudeNumber}" (${claudeHero}) but card not found in database`;
	return null;
}

// ── Cache Writeback ─────────────────────────────────────────

async function writeHashToAllLayers(
	hash: string,
	cardId: string,
	confidence: number
): Promise<void> {
	// Layer 1: IndexedDB
	try {
		await idb.setHash({ phash: hash, card_id: cardId, confidence });
	} catch {
		// Non-critical
	}

	// Layer 3: Supabase (via service role on server, but client can insert if allowed)
	try {
		const client = getSupabase();
		if (client) {
			await client.from('hash_cache').upsert(
				{
					phash: hash,
					card_id: cardId,
					confidence,
					scan_count: 1,
					last_seen: new Date().toISOString()
				},
				{ onConflict: 'phash' }
			);
		}
	} catch {
		// Non-critical
	}
}

// ── Helpers ─────────────────────────────────────────────────

async function fetchCardById(cardId: string): Promise<Card | null> {
	const client = getSupabase();
	if (!client) return null;
	const { data } = await client.from('cards').select('*').eq('id', cardId).maybeSingle();
	return data as Card | null;
}
