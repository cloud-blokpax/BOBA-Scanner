/**
 * Tesseract.js OCR Web Worker (runs off main thread)
 *
 * Exposed via Comlink:
 *   - initialize() → void
 *   - recognizeText(imageBlob) → { text, confidence, words }
 *   - extractCardNumber(text) → string | null
 *   - terminate() → void
 */
import Tesseract from 'tesseract.js';
import * as Comlink from 'comlink';

interface OcrWord {
	text: string;
	confidence: number;
}

interface OcrResult {
	text: string;
	confidence: number;
	words: OcrWord[];
}

let worker: Tesseract.Worker | null = null;
let recognitionCount = 0;

const ocrService = {
	async initialize(whitelist?: string): Promise<void> {
		worker = await Tesseract.createWorker('eng', 1, {
			langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast'
		});
		await worker.setParameters({
			tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
			tessedit_char_whitelist:
				whitelist || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- '
		});
	},

	async recognizeText(imageBlob: Blob): Promise<OcrResult> {
		if (!worker) await this.initialize();

		// Restart worker every 100 recognitions (WASM memory leak mitigation)
		if (++recognitionCount > 100) {
			await worker!.terminate();
			await this.initialize();
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
	},

	/**
	 * Extract card number from OCR text.
	 * Handles common OCR confusables (0↔O, 1↔I, etc.)
	 */
	extractCardNumber(text: string): string | null {
		const upper = text
			.toUpperCase()
			.replace(/[|!¡]/g, 'I')
			.replace(/[\\/()\[\].,]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		const patterns: RegExp[] = [
			/\b([A-Z]{1,6})[-–—]\s*(\d{1,4})\b/,
			/\b([A-Z]{1,6})\s+(\d{2,4})\b/,
			/\b([A-Z]{1,6})(\d{2,4})\b/,
			/([A-Z]{2,})[\s\-–—]*(\d{2,})/
		];

		for (const pattern of patterns) {
			const match = upper.match(pattern);
			if (match) {
				// Fix common OCR confusables in letter prefix
				const prefix = match[1]
					.replace(/0/g, 'O')
					.replace(/8/g, 'B')
					.replace(/5/g, 'S')
					.replace(/1/g, 'I')
					.replace(/2/g, 'Z')
					.replace(/6/g, 'G');
				// Fix common OCR confusables in numeric part
				const numPart = match[2]
					.replace(/O/g, '0')
					.replace(/I/g, '1')
					.replace(/B/g, '8')
					.replace(/S/g, '5')
					.replace(/Z/g, '2')
					.replace(/G/g, '6');
				return `${prefix}-${numPart}`;
			}
		}

		// Numeric-only fallback (Alpha Edition: "76", "115")
		const numOnly = upper.match(/\b(\d{2,4})\b/);
		if (numOnly) return numOnly[1];

		return null;
	},

	async terminate(): Promise<void> {
		if (worker) {
			await worker.terminate();
			worker = null;
		}
	}
};

Comlink.expose(ocrService);
