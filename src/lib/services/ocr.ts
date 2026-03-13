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

export async function initOcr(whitelist?: string): Promise<void> {
	worker = await Tesseract.createWorker('eng', 1);
	await worker.setParameters({
		tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
		tessedit_char_whitelist:
			whitelist || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- '
	});
}

export async function recognizeText(imageBlob: Blob): Promise<OcrResult> {
	if (!worker) await initOcr();

	// Restart worker every 100 recognitions (WASM memory leak mitigation)
	if (++recognitionCount > 100) {
		await worker!.terminate();
		await initOcr();
		recognitionCount = 0;
	}

	const { data } = await worker!.recognize(imageBlob);

	// Extract words from block→paragraph→line→word hierarchy
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
}

export async function terminateOcr(): Promise<void> {
	if (worker) {
		await worker.terminate();
		worker = null;
	}
}
