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
// Doc 2, Phase 4 — standalone Recognition instance for the rec-only path.
// Skips PaddleOCR's text-detection model on known-location sub-ROIs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _recognition: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _initPromise: Promise<any> | null = null;
let _initStartedAt: number | null = null;

/** A single PaddleOCR detection. `box` is a 4-point polygon in original-bitmap pixel coords. */
export interface OCRBox {
	text: string;
	score: number;
	box: number[][];
}

export interface OCRResult {
	text: string;
	confidence: number;
	boxes: OCRBox[];
}

/**
 * Compute the centroid of a polygon in normalized [0,1] coordinates relative
 * to the bitmap. Returns null if the polygon is empty or malformed. Used by
 * region-containment checks and the parallel classifier's left-edge filter.
 */
export function boxCenterNormalized(
	boxPoints: number[][],
	bitmapW: number,
	bitmapH: number
): { x: number; y: number } | null {
	if (!Array.isArray(boxPoints) || boxPoints.length === 0) return null;
	let sx = 0;
	let sy = 0;
	let n = 0;
	for (const p of boxPoints) {
		if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
			sx += p[0];
			sy += p[1];
			n++;
		}
	}
	if (n === 0) return null;
	return { x: sx / n / bitmapW, y: sy / n / bitmapH };
}

/** True iff p is inside the [x, x+w] × [y, y+h] rectangle. All coords normalized. */
export function regionContains(
	r: { x: number; y: number; w: number; h: number },
	p: { x: number; y: number }
): boolean {
	return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/**
 * Pick the top-most box from a set of OCR detections, ordered by centroid Y.
 *
 * The hero name is always the top line in the name region; subtitles and
 * edition stamps ("FIRST EDITION", "WORLD CHAMPIONS DEBUT", future variants)
 * are always below it. Picking the top-Y box gives the hero name directly,
 * avoiding the need for a stamp-pattern dictionary.
 */
export function pickTopBox(boxes: OCRBox[]): OCRBox | null {
	if (!boxes || boxes.length === 0) return null;
	let best: OCRBox | null = null;
	let bestY = Infinity;
	for (const b of boxes) {
		if (!b.text) continue;
		if (!Array.isArray(b.box) || b.box.length === 0) {
			if (!best) best = b;
			continue;
		}
		let sy = 0;
		let n = 0;
		for (const p of b.box) {
			if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[1])) {
				sy += p[1];
				n++;
			}
		}
		if (n === 0) continue;
		const avgY = sy / n;
		if (avgY < bestY) {
			bestY = avgY;
			best = b;
		}
	}
	return best;
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

		// Doc 2, Phase 4 — Recognition-only path. Build a standalone
		// Recognition model using the same model paths as Ocr. Lets sub-ROI
		// OCR skip the detection model entirely on known-location regions,
		// cutting per-region latency and giving the rec head a cleaner input.
		// The Recognition class is not in @gutenye/ocr-common's package.json
		// `exports` whitelist; vite.config.ts aliases the bare specifier
		// 'gutenye-ocr-recognition' to the file path to bypass that.
		// Soft-fail — if init throws, ocrRecOnly falls back to ocrRegion.
		try {
			// The bare specifier is rewritten by vite.config.ts's resolve.alias
			// to the file path of @gutenye/ocr-common's Recognition.js, since
			// the class isn't in the package's `exports` whitelist. TypeScript
			// can't see this rewrite, so we go through a string indirection
			// that bypasses the static module resolution check at compile time.
			const RECOGNITION_SPECIFIER = 'gutenye-ocr-recognition';
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const recMod: any = await import(/* @vite-ignore */ RECOGNITION_SPECIFIER);
			const RecognitionClass = recMod.Recognition ?? recMod.default;
			if (RecognitionClass && typeof RecognitionClass.create === 'function') {
				_recognition = await RecognitionClass.create({ models: PADDLE_MODEL_CONFIG });
			}
		} catch (err) {
			console.warn('[paddle-ocr] Recognition standalone init failed:', err);
			_recognition = null;
		}
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
 * Minimal `LineImage.image` shim consumed by `Recognition.run()`. The package's
 * own `ImageRaw` (browser flavor) builds a `<canvas>` via `document.createElement`
 * — main-thread only. This shim wraps an `OffscreenCanvas` instead, so it works
 * on both main thread and Web Workers, and keeps `.data`/.width/.height in
 * sync with the canvas across `.resize()` calls.
 *
 * Recognition's actual contract:
 *   1. `image.resize({ height: 48 })` → returns `this` (or compatible) with
 *      .data/.width/.height updated. The model wants ~48px tall input.
 *   2. `image.data[i]` indexed as RGBA bytes by `ModelBase.imageToInput`.
 */
class RecLineImage {
	data: Uint8ClampedArray;
	width: number;
	height: number;
	private canvas: OffscreenCanvas;

	constructor(canvas: OffscreenCanvas) {
		this.canvas = canvas;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2D context unavailable');
		const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
		this.data = img.data;
		this.width = img.width;
		this.height = img.height;
	}

	async resize({ width, height }: { width?: number; height?: number }): Promise<RecLineImage> {
		if (width === undefined && height === undefined) return this;
		const newW = width ?? Math.max(1, Math.round((this.width / this.height) * (height ?? 1)));
		const newH = height ?? Math.max(1, Math.round((this.height / this.width) * (width ?? 1)));
		if (newW === this.width && newH === this.height) return this;
		const next = new OffscreenCanvas(newW, newH);
		const ctx = next.getContext('2d');
		if (!ctx) throw new Error('2D context unavailable');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(this.canvas, 0, 0, newW, newH);
		const img = ctx.getImageData(0, 0, newW, newH);
		this.canvas = next;
		this.data = img.data;
		this.width = newW;
		this.height = newH;
		return this;
	}
}

/**
 * Recognition-only sub-ROI OCR. Doc 2, Phase 4.
 *
 * Skips PaddleOCR's text-detection model entirely. The caller passes a
 * region of the source bitmap; we crop, scale to the rec head's preferred
 * line height, and feed it directly to `Recognition.run()` as a single
 * pre-located text line.
 *
 * Use this when the text location is ALREADY KNOWN — i.e., on the rectified
 * canonical with fixed ROIs from `ocr-regions.ts`. Faster per region than
 * `ocrRegion` (no detection pass) and gives the rec head a controlled input
 * size (it was trained on ~48px tall lines).
 *
 * Falls back to `ocrRegion` when the standalone Recognition didn't initialize
 * — this keeps correctness while perf is lost.
 */
export async function ocrRecOnly(
	bitmap: ImageBitmap,
	region: { x: number; y: number; w: number; h: number },
	options: { targetHeight?: number } = {}
): Promise<OCRResult> {
	if (!_recognition) {
		// Fallback path — caller's pipeline still works, just slower.
		return ocrRegion(bitmap, region, { minWidth: 800 });
	}

	const { targetHeight = 48 } = options;
	const sx = Math.max(0, Math.floor(region.x));
	const sy = Math.max(0, Math.floor(region.y));
	const sw = Math.min(bitmap.width - sx, Math.floor(region.w));
	const sh = Math.min(bitmap.height - sy, Math.floor(region.h));
	if (sw <= 0 || sh <= 0) {
		return { text: '', confidence: 0, boxes: [] };
	}

	// Scale to the rec head's training height. The rec head re-resizes
	// internally via `image.resize({height: 48})` so going strictly to the
	// requested height is fine; we draw straight to the target so the
	// internal resize is a no-op (saves a copy).
	const scale = targetHeight / sh;
	const outW = Math.max(targetHeight, Math.round(sw * scale));
	const outH = targetHeight;

	const canvas = new OffscreenCanvas(outW, outH);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D context unavailable');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);

	const lineImage = new RecLineImage(canvas);
	const lineImages = [
		{
			image: lineImage,
			// box format: [[x1,y1],[x2,y1],[x2,y2],[x1,y2]] — clockwise from top-left.
			// The recognition's `calculateBox` echoes this back on output.
			box: [
				[0, 0],
				[outW, 0],
				[outW, outH],
				[0, outH]
			]
		}
	];

	try {
		const t0 = performance.now();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const lines: Array<{ text: string; mean: number; box?: number[][] }> =
			await _recognition.run(lineImages);
		const elapsed = performance.now() - t0;
		console.debug(
			`[paddle-ocr] ocrRecOnly ${outW}x${outH}: ${elapsed.toFixed(1)}ms`,
			lines?.[0]?.text ?? '∅'
		);

		if (!lines || lines.length === 0) {
			return { text: '', confidence: 0, boxes: [] };
		}
		// Rec head's calculateBox filter drops `mean < 0.5` lines internally,
		// so an empty array means rec was unsure. Treat as zero-confidence.
		const top = lines[0];
		const text = (top.text || '').trim();
		const score = typeof top.mean === 'number' ? top.mean : 0;
		return {
			text,
			confidence: score,
			boxes: [
				{
					text,
					score,
					// Map the line back into source-bitmap pixel space so callers
					// that compute centroids (regionContains, parallel classifier)
					// see the original location, not the rec input rect.
					box: [
						[sx, sy],
						[sx + sw, sy],
						[sx + sw, sy + sh],
						[sx, sy + sh]
					]
				}
			]
		};
	} catch (err) {
		console.debug('[paddle-ocr] ocrRecOnly threw, falling back to ocrRegion:', err);
		return ocrRegion(bitmap, region, { minWidth: 800 });
	}
}

/**
 * Phase 2 Doc 2.4 — batched recognition over multiple known-location regions.
 *
 * Mirrors ocrRecOnly's preprocessing but submits all regions to the
 * Recognition model in one Recognition.run() call. The package's run()
 * already preprocesses input images in parallel via Promise.all; the
 * savings come from sharing one ONNX session warm-up and one decode pass.
 *
 * Returns results in the same order as the input regions. Empty regions
 * (zero size, off-bitmap) come back as { text: '', confidence: 0, boxes: [] }.
 *
 * Falls back to running per-region ocrRecOnly serially when the standalone
 * Recognition didn't initialize. Throws (caller falls back) if the batched
 * Recognition.run() itself throws.
 */
export async function ocrRecOnlyBatch(
	bitmap: ImageBitmap,
	regions: Array<{
		region: { x: number; y: number; w: number; h: number };
		targetHeight?: number;
	}>
): Promise<OCRResult[]> {
	if (regions.length === 0) return [];

	if (!_recognition) {
		// Fallback: per-region ocrRecOnly (which itself falls back to ocrRegion
		// when the recognition standalone is missing). Correctness preserved
		// at the cost of the batching speedup.
		return Promise.all(
			regions.map((r) =>
				ocrRecOnly(bitmap, r.region, r.targetHeight ? { targetHeight: r.targetHeight } : {})
			)
		);
	}

	// Phase 2 Doc 2.4.1 — bypass Recognition.run() entirely.
	//
	// The package's run() method finishes by calling afAfRec(), which groups
	// output lines by horizontal midline. All our region crops have midlines
	// within the grouping threshold, so afAfRec collapses them into one
	// joined line. It also filters mean < 0.5, breaking our index alignment.
	// Both behaviours are correct for natural-document OCR but hostile to
	// pre-localised region OCR.
	//
	// Solution: drive the rec head directly via imageToInput / runModel /
	// decodeText. These are public methods inherited from ModelBase. The
	// rec head's resize-to-48 happens inside run(), so we replicate it here
	// before imageToInput.

	type Pre = {
		canvas: OffscreenCanvas | null;
		sx: number;
		sy: number;
		sw: number;
		sh: number;
	};

	const pre: Pre[] = regions.map(({ region }) => {
		const sx = Math.max(0, Math.floor(region.x));
		const sy = Math.max(0, Math.floor(region.y));
		const sw = Math.min(bitmap.width - sx, Math.floor(region.w));
		const sh = Math.min(bitmap.height - sy, Math.floor(region.h));
		if (sw <= 0 || sh <= 0) {
			return { canvas: null, sx, sy, sw, sh };
		}
		// Resize directly to height=48 (the rec head's training height) so
		// no internal resize step is needed. Width scales proportionally.
		const REC_HEIGHT = 48;
		const scale = REC_HEIGHT / sh;
		const outW = Math.max(REC_HEIGHT, Math.round(sw * scale));
		const canvas = new OffscreenCanvas(outW, REC_HEIGHT);
		const ctx = canvas.getContext('2d');
		if (!ctx) return { canvas: null, sx, sy, sw, sh };
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, REC_HEIGHT);
		return { canvas, sx, sy, sw, sh };
	});

	// Convert each prepared canvas to ModelData in parallel.
	// imageToInput is pure CPU work over the pixel buffer.
	const modelDatas = await Promise.all(
		pre.map(async (p) => {
			if (!p.canvas) return null;
			// RecLineImage wraps the canvas with the .data / .width / .height
			// shape that imageToInput expects (and that ModelBase.imageToInput
			// reads via image.data).
			const lineImage = new RecLineImage(p.canvas);
			// imageToInput is synchronous in the package source; await for
			// type-uniformity with future async preprocessing changes.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return (_recognition as any).imageToInput(lineImage, {});
		})
	);

	// Run inference per modelData. ONNX session is single-threaded; sequential
	// is the right shape. The save vs. ocrRecOnly is one Promise round-trip
	// per region for preprocessing + decoding.
	const t0 = performance.now();
	const outputs: Array<unknown | null> = [];
	for (const md of modelDatas) {
		if (md === null) {
			outputs.push(null);
			continue;
		}
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const out = await (_recognition as any).runModel({ modelData: md });
			outputs.push(out);
		} catch (err) {
			console.debug('[paddle-ocr] ocrRecOnlyBatch runModel threw, region falls back to empty', err);
			outputs.push(null);
		}
	}
	// Decode in parallel — also CPU-bound work.
	const lines = await Promise.all(
		outputs.map(async (out, i) => {
			if (out === null) return null;
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const decoded = await (_recognition as any).decodeText(out);
				// decodeText returns an array of { text, mean }; for our 1-image
				// inputs that's always a single-element array.
				if (!Array.isArray(decoded) || decoded.length === 0) return null;
				return decoded[0] as { text: string; mean: number };
			} catch (err) {
				console.debug(`[paddle-ocr] ocrRecOnlyBatch decodeText[${i}] threw`, err);
				return null;
			}
		})
	);
	const elapsed = performance.now() - t0;
	console.debug(
		`[paddle-ocr] ocrRecOnlyBatch n=${regions.length}: ${elapsed.toFixed(1)}ms (bypass)`
	);

	// Map results back to OCRResult shape. Order matches input order by
	// construction — index `i` in `lines` always corresponds to `regions[i]`.
	return regions.map((r, i) => {
		const p = pre[i];
		const line = lines[i];
		if (!line || !line.text) {
			return { text: '', confidence: 0, boxes: [] };
		}
		const text = (line.text || '').trim();
		const score = typeof line.mean === 'number' ? line.mean : 0;
		return {
			text,
			confidence: score,
			boxes: [
				{
					text,
					score,
					// Source-bitmap pixel coords for the region — matches the
					// shape ocrRecOnly emits.
					box: [
						[p.sx, p.sy],
						[p.sx + p.sw, p.sy],
						[p.sx + p.sw, p.sy + p.sh],
						[p.sx, p.sy + p.sh]
					]
				}
			]
		};
	});
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

/**
 * Force-release the PaddleOCR client. The next `initPaddleOCR()` call will
 * lazy-load a fresh instance.
 *
 * Use between independent scan operations on memory-constrained devices
 * (iOS Safari) to prevent WASM heap accumulation from one scan affecting
 * the next. Cost is a cold-start (~300–600ms) on the next call — fine for
 * upload flows, NOT for live camera scanning where FPS matters.
 *
 * The underlying `@gutenye/ocr-browser` Ocr class doesn't document a
 * termination API, so we try the common ONNX Runtime patterns
 * (`release` / `destroy` / `terminate`) defensively and null the module
 * locals regardless. Even without an explicit teardown call, dropping the
 * reference lets the GC reclaim the ONNX session and OpenCV mats.
 */
export async function releaseOcrWorker(): Promise<void> {
	const client = _client;
	const recognition = _recognition;
	_client = null;
	_recognition = null;
	_initPromise = null;
	_initStartedAt = null;
	if (!client && !recognition) return;
	try {
		if (client) {
			if (typeof client.release === 'function') await client.release();
			else if (typeof client.destroy === 'function') await client.destroy();
			else if (typeof client.terminate === 'function') await client.terminate();
		}
		if (recognition) {
			if (typeof recognition.release === 'function') await recognition.release();
			else if (typeof recognition.destroy === 'function') await recognition.destroy();
		}
	} catch (err) {
		console.warn('[paddle-ocr] release failed (ignored):', err);
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOCRResult(raw: any): OCRResult {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const boxes: OCRBox[] = ((raw?.lines || raw || []) as any[]).map((l: any) => ({
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
		.map((b) => b.text)
		.join(' ')
		.trim();
	const confidence = boxes.length
		? boxes.reduce((acc, b) => acc + b.score, 0) / boxes.length
		: 0;
	return { text, confidence, boxes };
}
