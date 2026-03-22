/**
 * OCR Service — Tesseract.js wrapper (no Comlink nesting)
 *
 * Tesseract.js manages its own internal Web Worker, so OCR computation
 * runs off the main thread without needing an additional Comlink wrapper.
 */
import Tesseract from 'tesseract.js';

interface OcrWord {
	text: string;
	confidence: number;
}

export interface OcrResult {
	text: string;
	confidence: number;
	words: OcrWord[];
}

let worker: Tesseract.Worker | null = null;
let recognitionCount = 0;
let _initPromise: Promise<void> | null = null;

export async function initOcr(whitelist?: string): Promise<void> {
	// Prevent concurrent initialization
	if (worker) return;
	if (_initPromise) return _initPromise;

	_initPromise = (async () => {
		if (worker) return; // Double-check after awaiting
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
	if (++recognitionCount > 50) {
		try {
			const oldWorker = worker;
			worker = null;
			_initPromise = null;
			await oldWorker!.terminate();
			await initOcr();
			recognitionCount = 0;
		} catch (err) {
			console.warn('[ocr] Worker restart failed, reinitializing:', err);
			worker = null;
			_initPromise = null;
			await initOcr();
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
