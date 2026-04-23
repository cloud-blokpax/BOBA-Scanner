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

// ONNX model assets served from our own /static directory so we don't
// depend on a CDN chain for the heavy weights. One-time ~15MB cold load
// per user, then browser-cached. Files committed under static/models/.
const PADDLE_MODEL_CONFIG = {
	detectionPath: '/models/ch_PP-OCRv4_det_infer.onnx',
	recognitionPath: '/models/ch_PP-OCRv4_rec_infer.onnx',
	dictionaryPath: '/models/ppocr_keys_v1.txt'
} as const;

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
		// Package's documented API is a default export with a static
		// `.create(options)` method. See npm/@gutenye/ocr-browser README.
		// A single clean read — no optional-chain fallback chain — because
		// re-accessing the default binding through the CDN module's combined
		// `export *` + `export {default}` re-export throws on stricter ESM
		// engines (Safari iOS 17+).
		const Ocr = mod.default;
		if (!Ocr || typeof Ocr.create !== 'function') {
			throw new Error(
				'[paddle-ocr] module default export missing `create`; ' +
					'CDN module shape unexpected. Got keys: ' +
					Object.keys(mod ?? {}).join(', ')
			);
		}
		_client = await Ocr.create({ models: PADDLE_MODEL_CONFIG });
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
	return buildOCRResult(result);
}

/**
 * Full-frame OCR — slower than region-cropped but robust to region-coord drift.
 * Used by:
 *   - Tier 1 canonical pass as a fallback when region OCR returns low conf
 *   - Wonders parallel classifier's OCM/Stonefoil rules (single read powers both)
 *
 * Validated on 20 real phone-photographed cards at 2400px long edge:
 *   - card_number returned among detected boxes at conf ≥ 0.97 in every case
 *   - name returned at conf ≥ 0.92 in every case (including the LA-35 kanji card)
 *
 * 15MB model covers Latin + CJK glyphs. Do NOT load a second language model.
 */
export async function ocrFullFrame(
	bitmap: ImageBitmap,
	options: { maxLongEdge?: number } = {}
): Promise<OCRResult> {
	if (!_client) throw new Error('PaddleOCR not initialized');

	const { maxLongEdge = 2400 } = options;
	const longEdge = Math.max(bitmap.width, bitmap.height);
	const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
	const W = Math.round(bitmap.width * scale);
	const H = Math.round(bitmap.height * scale);

	const canvas = new OffscreenCanvas(W, H);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D context unavailable');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, 0, 0, W, H);
	const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });

	const result = await _client.detect(blob);
	return buildOCRResult(result);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOCRResult(raw: any): OCRResult {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const boxes = ((raw?.lines || raw || []) as any[]).map((l: any) => ({
		text: (l.text || '').trim(),
		score:
			typeof l.score === 'number'
				? l.score
				: typeof l.confidence === 'number'
					? l.confidence
					: 0,
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
