/**
 * OCR Service — Tesseract.js wrapper (no Comlink nesting)
 *
 * Tesseract.js manages its own internal Web Worker, so OCR computation
 * runs off the main thread without needing an additional Comlink wrapper.
 *
 * IMPORTANT: Tesseract is dynamically imported to keep it out of the
 * initial shared chunk. It only downloads when OCR is first triggered
 * (Tier 2 of the recognition pipeline).
 */

// Tesseract types — import type-only so it's erased at build time
import type { Worker as TesseractWorker } from 'tesseract.js';
import { BOBA_PIPELINE_CONFIG } from '$lib/data/boba-config';

interface OcrWord {
	text: string;
	confidence: number;
}

export interface OcrResult {
	text: string;
	confidence: number;
	words: OcrWord[];
}

let worker: TesseractWorker | null = null;
let recognitionCount = 0;
let _initPromise: Promise<void> | null = null;

export async function initOcr(whitelist?: string): Promise<void> {
	// Prevent concurrent initialization
	if (worker) return;
	if (_initPromise) return _initPromise;

	_initPromise = (async () => {
		if (worker) return; // Double-check after awaiting

		// Dynamic import — Vite splits Tesseract into its own async chunk
		const Tesseract = await import('tesseract.js');

		worker = await Tesseract.createWorker('eng', 1);
		await worker.setParameters({
			tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
			tessedit_char_whitelist:
				whitelist || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. '
		});
	})();

	try {
		await _initPromise;
	} finally {
		_initPromise = null;
	}
}

export async function recognizeText(imageBlob: Blob): Promise<OcrResult> {
	if (!worker) await initOcr();

	// Restart worker every 50 recognitions (WASM memory leak mitigation, reduced from 100 for better mobile memory)
	if (++recognitionCount > BOBA_PIPELINE_CONFIG.ocrWorkerRestartInterval) {
		try {
			const oldWorker = worker;
			// Don't null out worker or _initPromise until new worker is ready
			const Tesseract = await import('tesseract.js');
			const newWorker = await Tesseract.createWorker('eng', 1);
			await newWorker.setParameters({
				tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
				tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. '
			});
			// Atomic swap — old worker is replaced only after new one is ready
			worker = newWorker;
			recognitionCount = 0;
			// Terminate old worker in background (non-blocking)
			oldWorker?.terminate().catch(() => {});
		} catch (err) {
			console.warn('[ocr] Worker restart failed:', err);
			// Keep the existing worker running — better than no worker
			recognitionCount = 0;
		}
	}

	// Guard: reject tiny blobs that would cause Tesseract internal warnings
	if (imageBlob.size < 100) {
		return { text: '', confidence: 0, words: [] };
	}

	try {
		const { data } = await worker!.recognize(imageBlob);

		const words: OcrWord[] = [];
		if (data.blocks) {
			for (const block of data.blocks) {
				for (const para of block.paragraphs) {
					for (const line of para.lines) {
						for (const w of line.words) {
							words.push({ text: w.text, confidence: w.confidence });
						}
					}
				}
			}
		}

		return {
			text: data.text.trim(),
			confidence: data.confidence,
			words
		};
	} catch (err) {
		console.warn('[ocr] Recognition failed:', err);
		// Return empty result instead of throwing — let the pipeline continue
		return { text: '', confidence: 0, words: [] };
	}
}

export async function terminateOcr(): Promise<void> {
	if (worker) {
		await worker.terminate();
		worker = null;
	}
	_initPromise = null;
}
