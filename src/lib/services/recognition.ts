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
import { findCard, loadCardDatabase, normalizeCardNum } from './card-db';
import { getSupabase } from './supabase';
import { checkCorrection, recordCorrection } from '$lib/services/scan-learning';
import { addToScanHistory } from '$lib/stores/scan-history';
import { BOBA_OCR_REGIONS, BOBA_SCAN_CONFIG } from '$lib/data/boba-config';
import type { Card, ScanResult, ScanMethod, HashCacheEntry } from '$lib/types';

// ── Worker instances ────────────────────────────────────────

let imageWorker: Comlink.Remote<{
	computeDHash: (bitmap: ImageBitmap, size?: number) => Promise<string>;
	hammingDistance: (a: string, b: string) => number;
	resizeForUpload: (bitmap: ImageBitmap, max?: number) => Promise<Blob>;
	checkBlurry: (bitmap: ImageBitmap, threshold?: number) => Promise<{ isBlurry: boolean; variance: number }>;
	preprocessForOCR: (bitmap: ImageBitmap, region: { x: number; y: number; w: number; h: number }) => Promise<Blob>;
}> | null = null;

let ocrWorker: Comlink.Remote<{
	initialize: (whitelist?: string) => Promise<void>;
	recognizeText: (blob: Blob) => Promise<{ text: string; confidence: number; words: Array<{ text: string; confidence: number }> }>;
	extractCardNumber: (text: string) => Promise<string | null>;
	terminate: () => Promise<void>;
}> | null = null;

// Tracks the last OCR reading for correction recording
let _lastOcrReading: string | null = null;

/**
 * Initialize the Web Workers. Call once on app start.
 */
export async function initWorkers(): Promise<void> {
	if (!imageWorker) {
		const ImageWorker = new Worker(
			new URL('$lib/workers/image-processor.ts', import.meta.url),
			{ type: 'module' }
		);
		imageWorker = Comlink.wrap(ImageWorker);
	}

	if (!ocrWorker) {
		const OcrWorker = new Worker(
			new URL('$lib/workers/ocr-worker.ts', import.meta.url),
			{ type: 'module' }
		);
		ocrWorker = Comlink.wrap(OcrWorker);
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
	onTierChange?: (tier: 1 | 2 | 3) => void
): Promise<ScanResult> {
	const startTime = performance.now();
	await initWorkers();
	await loadCardDatabase();

	// Reset OCR reading tracker for this scan
	_lastOcrReading = null;

	// Convert to ImageBitmap for worker transfer
	const bitmap =
		imageSource instanceof ImageBitmap
			? imageSource
			: await createImageBitmap(imageSource);

	// ── Check blur ──────────────────────────────────────────
	const blurResult = await imageWorker!.checkBlurry(bitmap, BOBA_SCAN_CONFIG.blurThreshold);
	if (blurResult.isBlurry) {
		return {
			card_id: null,
			card: null,
			scan_method: 'hash_cache',
			confidence: 0,
			processing_ms: Math.round(performance.now() - startTime),
		};
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
	const tier1Result = await runTier1(bitmap);
	if (tier1Result) {
		return finalize(tier1Result);
	}

	// ── TIER 2: OCR + Fuzzy Match ───────────────────────────
	onTierChange?.(2);
	const tier2Result = await runTier2(bitmap);
	if (tier2Result) {
		// Write hash back to cache for future lookups
		const hash = await imageWorker!.computeDHash(bitmap);
		await writeHashToAllLayers(hash, tier2Result.card_id!, tier2Result.confidence);
		return finalize(tier2Result);
	}

	// ── TIER 3: Claude API ──────────────────────────────────
	onTierChange?.(3);
	const tier3Result = await runTier3(bitmap);
	if (tier3Result) {
		const hash = await imageWorker!.computeDHash(bitmap);
		await writeHashToAllLayers(hash, tier3Result.card_id!, tier3Result.confidence);

		// Record correction: Tier 2 read something but couldn't match; Tier 3 found the right card.
		if (tier3Result.card_id && tier3Result.card?.card_number && _lastOcrReading) {
			recordCorrection(_lastOcrReading, tier3Result.card.card_number, 'ai');
		}
	}
	return finalize(
		tier3Result || { card_id: null, card: null, scan_method: 'claude' as ScanMethod, confidence: 0, processing_ms: 0 }
	);
}

// ── Tier 1: Hash Cache Lookup ───────────────────────────────

async function runTier1(bitmap: ImageBitmap): Promise<ScanResult | null> {
	const hash = await imageWorker!.computeDHash(bitmap);

	// Layer 1: IndexedDB (instant, free)
	const idbEntry = await idb.getHash(hash) as Pick<HashCacheEntry, 'card_id' | 'confidence'> | undefined;
	if (idbEntry) {
		const card = findCard(idbEntry.card_id) || await fetchCardById(idbEntry.card_id);
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
		const card = findCard(supaEntry.card_id) || await fetchCardById(supaEntry.card_id);
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

async function runTier2(bitmap: ImageBitmap): Promise<ScanResult | null> {
	for (const region of BOBA_OCR_REGIONS) {
		try {
			// Preprocess region in image worker
			const processedBlob = await withTimeout(
				imageWorker!.preprocessForOCR(bitmap, region),
				5000, 'OCR preprocess'
			);

			// Run OCR in OCR worker (timeout at 10s per region)
			const ocrResult = await withTimeout(
				ocrWorker!.recognizeText(processedBlob),
				10000, 'OCR recognition'
			);
			if (ocrResult.confidence < BOBA_SCAN_CONFIG.ocrConfidenceThreshold) continue;

			// Extract card number
			const resolvedNumber = await ocrWorker!.extractCardNumber(ocrResult.text);
			if (!resolvedNumber) continue;

			// Track the raw OCR reading for potential correction recording
			_lastOcrReading = resolvedNumber;

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

async function runTier3(bitmap: ImageBitmap): Promise<ScanResult | null> {
	let response: Response;
	try {
		// Resize for upload
		const imageBlob = await imageWorker!.resizeForUpload(bitmap, 1024);

		const formData = new FormData();
		formData.append('image', imageBlob, 'scan.jpg');

		response = await fetch('/api/scan', {
			method: 'POST',
			body: formData
		});
	} catch (err) {
		console.error('Claude API scan network error:', err);
		return null;
	}

	if (!response.ok) {
		console.error('Claude API scan failed:', response.status);
		return null;
	}

	let result;
	try {
		result = await response.json();
	} catch {
		console.error('Claude API scan: invalid JSON response');
		return null;
	}
	if (!result.success || !result.card) return null;

	// Match Claude response to local card database
	const card = findCard(
		result.card.card_number,
		result.card.hero_name || result.card.card_name
	);

	if (card) {
		return {
			card_id: card.id,
			card,
			scan_method: 'claude',
			confidence: result.card.confidence || 0.9,
			processing_ms: 0,
			variant: result.card.variant || null
		};
	}

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
