/**
 * PaddleOCR wrapper with lazy init and region-specific OCR helper.
 * Loads the ~15MB ONNX model on demand; initialized at Scanner.svelte mount
 * so first-scan-ever has the model ready but users who never scan pay nothing.
 */

// Loaded from jsdelivr's ESM CDN at runtime instead of bundled. The package
// transitively pulls in @techstark/opencv-js (~10MB) + onnxruntime-web, which
// blew past the CI bundle-size budget when bundled. CSP already allows
// https://cdn.jsdelivr.net for both script-src and connect-src.
// The `/* @vite-ignore */` tells Vite not to analyze the URL so the CDN
// module stays out of our client bundle entirely.
const OCR_BROWSER_CDN_URL =
	'https://cdn.jsdelivr.net/npm/@gutenye/ocr-browser@1.4.8/+esm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _initPromise: Promise<any> | null = null;
let _initStartedAt: number | null = null;

export interface OCRResult {
	text: string;
	confidence: number;
	boxes: Array<{ text: string; score: number; box: number[][] }>;
}

export async function initPaddleOCR(): Promise<void> {
	if (_client) return;
	if (_initPromise) {
		await _initPromise;
		return;
	}
	_initStartedAt = performance.now();
	_initPromise = (async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const mod: any = await import(/* @vite-ignore */ OCR_BROWSER_CDN_URL);
		const OcrClient = mod.OcrClient || mod.default?.OcrClient || mod.default;
		if (!OcrClient) throw new Error('PaddleOCR: OcrClient export not found');
		_client = await OcrClient.create();
		console.debug(
			'[paddle-ocr] initialized in',
			(performance.now() - _initStartedAt!).toFixed(0),
			'ms'
		);
		return _client;
	})();
	await _initPromise;
}

export function isPaddleOCRReady(): boolean {
	return _client !== null;
}

export async function ocrRegion(
	bitmap: ImageBitmap,
	region: { x: number; y: number; w: number; h: number },
	options: { minWidth?: number; charWhitelist?: string } = {}
): Promise<OCRResult> {
	if (!_client) throw new Error('PaddleOCR not initialized');

	const { minWidth = 800 } = options;
	const sx = Math.max(0, Math.floor(region.x));
	const sy = Math.max(0, Math.floor(region.y));
	const sw = Math.min(bitmap.width - sx, Math.floor(region.w));
	const sh = Math.min(bitmap.height - sy, Math.floor(region.h));
	if (sw <= 0 || sh <= 0) {
		return { text: '', confidence: 0, boxes: [] };
	}
	const scale = Math.max(1, minWidth / sw);

	const canvas = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D context unavailable');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
	const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });

	const result = await _client.detect(blob);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const boxes = ((result?.lines || result || []) as any[]).map((l: any) => ({
		text: (l.text || '').trim(),
		score: typeof l.score === 'number' ? l.score : typeof l.confidence === 'number' ? l.confidence : 0,
		box: l.box || l.points || []
	}));
	const text = boxes
		.map((b: { text: string }) => b.text)
		.join(' ')
		.trim();
	const confidence = boxes.length
		? boxes.reduce((acc: number, b: { score: number }) => acc + b.score, 0) / boxes.length
		: 0;

	return { text, confidence, boxes };
}
