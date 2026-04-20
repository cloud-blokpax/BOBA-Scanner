/**
 * Recognition Worker Management
 *
 * Manages the image processing Web Worker (Comlink proxy) and OCR
 * initialization lifecycle. Extracted from recognition.ts to isolate
 * worker state and provide a clean API for the recognition pipeline.
 */

import * as Comlink from 'comlink';
import { initOcr } from '$lib/services/ocr';
import { loadCorrectionsFromIdb } from '$lib/services/scan-learning';
import { BOBA_SCAN_CONFIG } from '$lib/data/boba-config';
import type { RectifyResult } from '$lib/workers/image-processor';

// Re-export the worker-side type so consumers (recognition.ts) can
// depend on a single source of truth without importing the worker module.
export type { RectifyResult, RectifyDiagnostic } from '$lib/workers/image-processor';

// ── Worker Type ────────────────────────────────────────────

export type ImageWorkerProxy = Comlink.Remote<{
	computeDHash: (bitmap: ImageBitmap, size?: number) => Promise<string>;
	computePHash: (bitmap: ImageBitmap, size?: number) => Promise<string>;
	hammingDistance: (a: string, b: string) => number;
	resizeForUpload: (bitmap: ImageBitmap, max?: number) => Promise<Blob>;
	checkBlurry: (bitmap: ImageBitmap, threshold?: number) => Promise<{ isBlurry: boolean; variance: number }>;
	checkGlare: (bitmap: ImageBitmap, brightnessThreshold?: number, areaThreshold?: number) => Promise<{ hasGlare: boolean; regions: Array<{ x: number; y: number; w: number; h: number }> }>;
	analyzeCardPresence: (bitmap: ImageBitmap, blurThreshold?: number) => Promise<{ cardDetected: boolean; isSharp: boolean; variance: number }>;
	computeQualitySignals: (bitmap: ImageBitmap) => Promise<{
		blur: number;
		luminanceMean: number;
		luminanceStd: number;
		overexposedPct: number;
		underexposedPct: number;
		edgeDensityCanny: number;
		passed: boolean;
		failReason: string | null;
	}>;
	preprocessForOCR: (bitmap: ImageBitmap, region: { x: number; y: number; w: number; h: number }) => Promise<Blob>;
	compositeMinPixel: (bitmaps: ImageBitmap[]) => Promise<ImageBitmap>;
	rectifyCard: (bitmap: ImageBitmap) => Promise<RectifyResult>;
}>;

// ── Worker State ───────────────────────────────────────────

let imageWorker: ImageWorkerProxy | null = null;
let _workerInitPromise: Promise<void> | null = null;
let _ocrAvailable = false;
let _ocrRetryAttempted = false;
let _initFailCount = 0;
const MAX_INIT_RETRIES = 3;

// ── Accessors ──────────────────────────────────────────────

/**
 * Get the initialized image worker proxy.
 * Throws if the worker has not been initialized yet.
 */
export function getImageWorker(): ImageWorkerProxy {
	if (!imageWorker) {
		throw new Error('Image worker not initialized. Call initWorkers() first.');
	}
	return imageWorker;
}

/** Whether OCR (Tesseract) is available for Tier 2 scanning. */
export function isOcrAvailable(): boolean {
	return _ocrAvailable;
}

/** Whether an OCR retry has already been attempted this session. */
export function wasOcrRetryAttempted(): boolean {
	return _ocrRetryAttempted;
}

/** Mark that an OCR retry has been attempted (prevents duplicate retries). */
export function markOcrRetryAttempted(): void {
	_ocrRetryAttempted = true;
}

/** Mark OCR as available (used after successful retry). */
export function markOcrAvailable(): void {
	_ocrAvailable = true;
}

/** Reset the worker failure counter so navigation acts as a retry. */
export function resetWorkerFailCount(): void {
	_initFailCount = 0;
}

// ── Worker Initialization ──────────────────────────────────

/**
 * Initialize the Web Workers. Call once on app start.
 * Uses a shared promise to prevent duplicate Worker creation from concurrent calls.
 */
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
					{ type: 'classic' }
				);
				imageWorker = Comlink.wrap(ImageWorker);
			} catch (err) {
				imageWorker = null;
				console.error('[scan] Worker constructor failed:', err);
				throw err;
			}
		}

		// Load OCR corrections into memory for synchronous lookups.
		// Awaited so corrections are available before the first scan.
		await loadCorrectionsFromIdb().catch((err) => console.warn('[scan] Failed to load OCR corrections from IDB:', err));

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

// ── Convenience Functions ──────────────────────────────────

/**
 * Analyze a video frame for card presence and sharpness (for auto-capture).
 */
export async function analyzeFrame(bitmap: ImageBitmap): Promise<{
	cardDetected: boolean;
	isSharp: boolean;
}> {
	await initWorkers();
	const result = await getImageWorker().analyzeCardPresence(bitmap, BOBA_SCAN_CONFIG.blurThreshold);
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
	const worker = getImageWorker();
	const [blur, glare] = await Promise.all([
		worker.checkBlurry(bitmap, BOBA_SCAN_CONFIG.blurThreshold),
		worker.checkGlare(bitmap)
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
	return getImageWorker().computeDHash(bitmap, 8);
}

/**
 * Compute Hamming distance between two hex hash strings.
 * Exposed for Scanner.svelte stability detection.
 */
export async function computeHammingDistance(a: string, b: string): Promise<number> {
	await initWorkers();
	return getImageWorker().hammingDistance(a, b);
}

/**
 * Composite multiple captures using darkest-pixel selection (for foil mode).
 * Runs in the web worker off the main thread.
 */
export async function compositeForFoilMode(bitmaps: ImageBitmap[]): Promise<ImageBitmap> {
	await initWorkers();
	return getImageWorker().compositeMinPixel(bitmaps);
}
