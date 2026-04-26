/**
 * PaddleOCR wrapper with lazy init and region-specific OCR helper.
 * Loads the ~15MB ONNX model on demand; initialized at Scanner.svelte mount
 * so first-scan-ever has the model ready but users who never scan pay nothing.
 */

// `@gutenye/ocr-browser` (npm dep) is imported dynamically so the OCR chain
// lives in a lazy chunk. Its two largest transitive deps — opencv-js (~10MB
// UMD with embedded WebAssembly) and onnxruntime-web (WASM loader + backend)
// — are aliased in vite.config.ts to runtime shims under src/lib/shims/ that
// load the real code from /vendor/ at runtime. That keeps both out of the
// client JS budget. The vendor files are copied from node_modules by
// scripts/copy-vendor.js as part of `npm run build`.
//
// opencv-js is a UMD bundle that attaches `window.cv` only after its
// Emscripten runtime finishes initializing — we must await that inside
// `preloadOpencv()` *before* importing `@gutenye/ocr-browser`, because the
// OCR library uses cv.* synchronously from within its async calls.

import { preloadOpencv } from '$lib/shims/opencv-js';

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
		// opencv MUST be globally available before ocr-browser links — the
		// shim resolves every `cv.*` access through globalThis.cv at call
		// time, so if the script tag hasn't finished loading/initializing
		// we'd throw the moment ocr-common runs splitIntoLineImages.
		await preloadOpencv();
		// Dynamic import (no `@vite-ignore`) so Vite chunk-splits the package
		// into a lazy-loaded chunk. opencv-js and onnxruntime-web are aliased
		// in vite.config.ts to the shims under $lib/shims, so this chunk
		// stays tiny — the real payloads live in /vendor/.
		const mod = await import('@gutenye/ocr-browser');
		// Package's documented API is a default export with a static
		// `.create(options)` method. See npm/@gutenye/ocr-browser README.
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

	// `@gutenye/ocr-browser` Ocr.detect(image: string) does `new Image(); img.src = image`,
	// so a Blob coerces to "[object Blob]" and fires GET /[object%20Blob] at the origin.
	// Pass an Object URL string instead and revoke after detect() resolves.
	// Diagnostic fingerprint: fa2b169ec41bba2c.
	const objectUrl = URL.createObjectURL(blob);
	try {
		const result = await _client.detect(objectUrl);
		return buildOCRResult(result);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
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

	// See ocrRegion for the rationale. Object URL string, not Blob.
	const objectUrl = URL.createObjectURL(blob);
	try {
		const result = await _client.detect(objectUrl);
		return buildOCRResult(result);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOCRResult(raw: any): OCRResult {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const boxes = ((raw?.lines || raw || []) as any[]).map((l: any) => ({
		text: (l.text || '').trim(),
		// `@gutenye/ocr-common` v1.4.8 emits `mean` (avg per-character
		// confidence). Verified against the package's published
		// TypeScript types and Recognition.decodeText output.
		// `score`/`confidence` retained as forward-compat fallbacks if
		// the field gets renamed in a future release.
		score:
			typeof l.mean === 'number'
				? l.mean
				: typeof l.score === 'number'
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
