/**
 * Three-Tier Recognition Pipeline
 *
 * Tier 1: Perceptual Hash (dHash) → IndexedDB → Redis → Supabase hash_cache
 * Tier 2: Tesseract.js OCR → Fuzzy match against local card DB
 * Tier 3: Claude API → Server-side identification
 *
 * Expected: 85-95% of scans resolved without Claude API calls.
 */

import * as Comlink from 'comlink';
import { idb } from './idb';
import { findCard, loadCardDatabase, normalizeCardNum } from './card-db';
import { supabase } from './supabase';
import type { Card, ScanResult, ScanMethod } from '$lib/types';

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

/**
 * Initialize the Web Workers. Call once on app start.
 */
export async function initWorkers(): Promise<void> {
	if (!imageWorker) {
		const ImageWorker = new Worker(
			new URL('$lib/workers/image-processor.js', import.meta.url),
			{ type: 'module' }
		);
		imageWorker = Comlink.wrap(ImageWorker);
	}

	if (!ocrWorker) {
		const OcrWorker = new Worker(
			new URL('$lib/workers/ocr-worker.js', import.meta.url),
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

	// Convert to ImageBitmap for worker transfer
	const bitmap =
		imageSource instanceof ImageBitmap
			? imageSource
			: await createImageBitmap(imageSource);

	// ── Check blur ──────────────────────────────────────────
	const blurResult = await imageWorker!.checkBlurry(bitmap, 100);
	if (blurResult.isBlurry) {
		return {
			card_id: null,
			card: null,
			scan_method: 'hash_cache',
			confidence: 0,
			processing_ms: Math.round(performance.now() - startTime),
		};
	}

	// ── TIER 1: Perceptual Hash Lookup ──────────────────────
	onTierChange?.(1);
	const tier1Result = await runTier1(bitmap);
	if (tier1Result) {
		return {
			...tier1Result,
			processing_ms: Math.round(performance.now() - startTime)
		};
	}

	// ── TIER 2: OCR + Fuzzy Match ───────────────────────────
	onTierChange?.(2);
	const tier2Result = await runTier2(bitmap);
	if (tier2Result) {
		// Write hash back to cache for future lookups
		const hash = await imageWorker!.computeDHash(bitmap);
		await writeHashToAllLayers(hash, tier2Result.card_id!, tier2Result.confidence);
		return {
			...tier2Result,
			processing_ms: Math.round(performance.now() - startTime)
		};
	}

	// ── TIER 3: Claude API ──────────────────────────────────
	onTierChange?.(3);
	const tier3Result = await runTier3(bitmap);
	if (tier3Result) {
		const hash = await imageWorker!.computeDHash(bitmap);
		await writeHashToAllLayers(hash, tier3Result.card_id!, tier3Result.confidence);
	}
	return {
		...(tier3Result || { card_id: null, card: null, scan_method: 'claude' as ScanMethod, confidence: 0 }),
		processing_ms: Math.round(performance.now() - startTime)
	};
}

// ── Tier 1: Hash Cache Lookup ───────────────────────────────

async function runTier1(bitmap: ImageBitmap): Promise<ScanResult | null> {
	const hash = await imageWorker!.computeDHash(bitmap);

	// Layer 1: IndexedDB (instant, free)
	const idbEntry = await idb.getHash(hash) as { card_id: string; confidence: number } | undefined;
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
	const { data: supaEntryRaw } = await supabase
		.from('hash_cache')
		.select('card_id, confidence')
		.eq('phash', hash)
		.single();

	const supaEntry = supaEntryRaw as { card_id: string; confidence: number } | null;

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

const OCR_REGIONS = [
	{ x: 0.01, y: 0.84, w: 0.35, h: 0.13 }, // Bottom-left (card number)
	{ x: 0.60, y: 0.84, w: 0.35, h: 0.13 }, // Bottom-right
	{ x: 0.0, y: 0.80, w: 1.0, h: 0.18 }    // Full bottom strip
];

async function runTier2(bitmap: ImageBitmap): Promise<ScanResult | null> {
	for (const region of OCR_REGIONS) {
		try {
			// Preprocess region in image worker
			const processedBlob = await imageWorker!.preprocessForOCR(bitmap, region);

			// Run OCR in OCR worker
			const ocrResult = await ocrWorker!.recognizeText(processedBlob);
			if (ocrResult.confidence < 30) continue;

			// Extract card number (Comlink wraps return in Promise)
			const resolvedNumber = await ocrWorker!.extractCardNumber(ocrResult.text);
			if (!resolvedNumber) continue;

			const card = findCard(resolvedNumber);
			if (card) {
				return {
					card_id: card.id,
					card,
					scan_method: 'tesseract',
					confidence: ocrResult.confidence / 100,
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
	// Resize for upload
	const imageBlob = await imageWorker!.resizeForUpload(bitmap, 1024);

	const formData = new FormData();
	formData.append('image', imageBlob, 'scan.jpg');

	const response = await fetch('/api/scan', {
		method: 'POST',
		body: formData
	});

	if (!response.ok) {
		console.error('Claude API scan failed:', response.status);
		return null;
	}

	const result = await response.json();
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
			processing_ms: 0
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
		await supabase.from('hash_cache').upsert(
			{
				phash: hash,
				card_id: cardId,
				confidence,
				scan_count: 1,
				last_seen: new Date().toISOString()
			},
			{ onConflict: 'phash' }
		);
	} catch {
		// Non-critical
	}
}

// ── Helpers ─────────────────────────────────────────────────

async function fetchCardById(cardId: string): Promise<Card | null> {
	const { data } = await supabase.from('cards').select('*').eq('id', cardId).single();
	return data as Card | null;
}
