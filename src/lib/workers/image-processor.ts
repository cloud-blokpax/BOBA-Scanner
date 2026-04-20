/**
 * Image Processing Web Worker (runs off main thread)
 *
 * Exposed via Comlink:
 *   - computeDHash(imageBitmap, hashSize) → 16-char hex perceptual hash
 *   - hammingDistance(hash1, hash2) → number
 *   - resizeForUpload(imageBitmap, maxDimension) → Blob
 *   - checkBlurry(imageBitmap, threshold) → { isBlurry, variance }
 *   - preprocessForOCR(imageBitmap, region) → Blob
 *   - rectifyCard(imageBitmap) → { bitmap, confidence, corners } | null
 */
import * as Comlink from 'comlink';

// ── OpenCV.js lazy-loader (card rectification only) ────────
// OpenCV ships as a ~11MB UMD bundle. We serve it as a static asset
// from /vendor/opencv.js (copied by scripts/copy-opencv.js at build
// time) and load it via importScripts() on first rectifyCard() call
// so it stays out of the rollup graph. The promise is cached so
// concurrent first-scans share the same load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _cvPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOpenCV(): Promise<any> {
	if (_cvPromise) return _cvPromise;
	_cvPromise = (async () => {
		// importScripts is synchronous and only available in classic
		// workers. The UMD wrapper detects the worker context and
		// attaches `cv` to the worker global (self).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(self as any).importScripts('/vendor/opencv.js');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cv: any = (self as any).cv;
		if (!cv) {
			throw new Error('OpenCV script loaded but self.cv is not defined');
		}

		// @techstark/opencv-js exposes `cv.ready` as the authoritative
		// "WASM runtime is done instantiating" signal. It's a Promise set
		// inside the module's evaluation and is safe to await regardless of
		// whether the runtime is already initialized or still loading.
		//
		// The older `cv.onRuntimeInitialized` callback pattern is unreliable
		// because Emscripten may have already fired init by the time we
		// assign the callback, resulting in a Promise that never resolves
		// (this was the source of the Session 1.4 scan hang).
		if (cv?.ready && typeof cv.ready.then === 'function') {
			// Race the ready promise against a 5-second hard cap. If WASM isn't
			// ready in 5s on modern hardware, something is deeply wrong — we'd
			// rather error and fall back than hang the user's scan forever.
			await Promise.race([
				cv.ready,
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('OpenCV cv.ready timed out after 5s')), 5000)
				)
			]);
		} else if (typeof cv?.Mat !== 'function') {
			// Fallback for builds that don't expose cv.ready: 5s race on
			// onRuntimeInitialized OR polling cv.Mat becoming a function.
			await Promise.race([
				new Promise<void>((resolve) => {
					if (typeof cv?.Mat === 'function') { resolve(); return; }
					cv.onRuntimeInitialized = () => resolve();
					// Polling fallback in case onRuntimeInitialized already fired
					const poll = setInterval(() => {
						if (typeof cv?.Mat === 'function') {
							clearInterval(poll);
							resolve();
						}
					}, 50);
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('OpenCV init timed out after 5s')), 5000)
				)
			]);
		}

		// Final sanity check: if we got here but cv.Mat still isn't callable,
		// something's wrong — throw so the catch clears the cached promise.
		if (typeof cv?.Mat !== 'function') {
			throw new Error('OpenCV load completed but cv.Mat is not available');
		}

		return cv;
	})().catch((err) => {
		_cvPromise = null; // allow retry on next scan
		throw err;
	});
	return _cvPromise;
}

// ── Rectification geometry helpers (no OpenCV needed) ──────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bitmapToMat(cv: any, bitmap: ImageBitmap): any {
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
	return cv.matFromImageData(imageData);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCorners(approx: any): Array<{ x: number; y: number }> {
	// approxPolyDP output is a 4×1×2 CV_32S matrix; coordinates live in data32S.
	const corners: Array<{ x: number; y: number }> = [];
	for (let i = 0; i < approx.rows; i++) {
		corners.push({
			x: approx.data32S[i * 2],
			y: approx.data32S[i * 2 + 1]
		});
	}
	return corners;
}

function orderCornersClockwise(
	corners: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
	// Image coordinates: origin top-left, y increases downward.
	//   TL = smallest (x+y)       BR = largest (x+y)
	//   TR = smallest (y-x)       BL = largest (y-x)
	const sums = corners.map((c) => c.x + c.y);
	const diffs = corners.map((c) => c.y - c.x);
	const tl = corners[sums.indexOf(Math.min(...sums))];
	const br = corners[sums.indexOf(Math.max(...sums))];
	const tr = corners[diffs.indexOf(Math.min(...diffs))];
	const bl = corners[diffs.indexOf(Math.max(...diffs))];
	return [tl, tr, br, bl];
}

function quadAspectRatio(orderedCorners: Array<{ x: number; y: number }>): number {
	const [tl, tr, br, bl] = orderedCorners;
	const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
	const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y);
	const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
	const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);
	const avgW = (topW + bottomW) / 2;
	const avgH = (leftH + rightH) / 2;
	if (avgH === 0) return 0;
	return avgW / avgH;
}

/**
 * Mean |corner angle − 90°| across the 4 corners of an ordered quad.
 * 0 = perfect rectangle; larger = more sheared / less card-like.
 * Used as one factor in the scoring-based quad selection.
 */
function averageCornerDeviation(ordered: Array<{ x: number; y: number }>): number {
	const deviations: number[] = [];
	for (let i = 0; i < 4; i++) {
		const prev = ordered[(i + 3) % 4];
		const curr = ordered[i];
		const next = ordered[(i + 1) % 4];
		const v1x = prev.x - curr.x;
		const v1y = prev.y - curr.y;
		const v2x = next.x - curr.x;
		const v2y = next.y - curr.y;
		const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
		if (mag === 0) {
			deviations.push(90); // degenerate corner, maximally bad
			continue;
		}
		const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / mag));
		const angleDeg = (Math.acos(cos) * 180) / Math.PI;
		deviations.push(Math.abs(angleDeg - 90));
	}
	return deviations.reduce((a, b) => a + b, 0) / 4;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanupMats(mats: Array<any>): void {
	for (const m of mats) {
		if (m && typeof m.delete === 'function') {
			try { m.delete(); } catch { /* ignore */ }
		}
	}
}

interface OcrRegion {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Per-attempt rectification diagnostic. Always populated — on both success
 * and failure paths — so the caller can write a rectification_attempt row
 * regardless of outcome. Drives data-driven threshold tuning.
 */
export interface RectifyDiagnostic {
	succeeded: boolean;
	fail_reason: string | null;
	total_ms: number;
	src_width: number;
	src_height: number;
	contour_count: number;
	quad_count: number;
	viable_quad_count: number;
	best_quad: {
		area_ratio: number;
		aspect: number;
		score: number;
		chosen: boolean;
		reject_reason: string | null;
		points: Array<{ x: number; y: number }>;
	} | null;
	timings: {
		gray_ms: number;
		blur_ms: number;
		canny_ms: number;
		dilate_ms: number;
		contour_ms: number;
		approx_ms: number;
		warp_ms: number;
	};
}

/**
 * Discriminated union: bitmap is non-null only on success. Diagnostic is
 * always present.
 */
export type RectifyResult =
	| {
			bitmap: ImageBitmap;
			confidence: number;
			corners: Array<{ x: number; y: number }>;
			diagnostic: RectifyDiagnostic;
	  }
	| {
			bitmap: null;
			diagnostic: RectifyDiagnostic;
	  };

// ── DCT-II coefficient matrix (32×32) for pHash ───────────
// C[k][n] = cos(π * k * (2n+1) / (2N))
// Row 0 scaled by 1/√N, others by √(2/N)
const DCT_SIZE = 32;
const DCT_MATRIX: Float64Array[] = [];
for (let k = 0; k < DCT_SIZE; k++) {
	DCT_MATRIX[k] = new Float64Array(DCT_SIZE);
	const scale = k === 0 ? 1 / Math.sqrt(DCT_SIZE) : Math.sqrt(2 / DCT_SIZE);
	for (let n = 0; n < DCT_SIZE; n++) {
		DCT_MATRIX[k][n] = scale * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * DCT_SIZE));
	}
}

const imageProcessor = {
	async computeDHash(imageBitmap: ImageBitmap, hashSize = 8): Promise<string> {
		const canvas = new OffscreenCanvas(hashSize + 1, hashSize);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(imageBitmap, 0, 0, hashSize + 1, hashSize);
		const pixels = ctx.getImageData(0, 0, hashSize + 1, hashSize).data;

		let hash = '';
		for (let y = 0; y < hashSize; y++) {
			for (let x = 0; x < hashSize; x++) {
				const idx = (y * (hashSize + 1) + x) * 4;
				const right = (y * (hashSize + 1) + x + 1) * 4;
				const leftGray =
					pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
				const rightGray =
					pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;
				hash += leftGray < rightGray ? '1' : '0';
			}
		}
		// hashSize*hashSize bits → hashSize*hashSize/4 hex digits
		const hexDigits = (hashSize * hashSize) / 4;
		return BigInt('0b' + hash)
			.toString(16)
			.padStart(hexDigits, '0');
	},

	/**
	 * Compute a perceptual hash using DCT (pHash algorithm).
	 * More robust than dHash for different lighting/angles.
	 * Returns a 64-char hex string (256-bit hash) for hashSize=16.
	 */
	async computePHash(imageBitmap: ImageBitmap, hashSize = 16): Promise<string> {
		// Resize to 32×32 for DCT
		const canvas = new OffscreenCanvas(DCT_SIZE, DCT_SIZE);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(imageBitmap, 0, 0, DCT_SIZE, DCT_SIZE);
		const pixels = ctx.getImageData(0, 0, DCT_SIZE, DCT_SIZE).data;

		// Convert to grayscale matrix
		const gray = new Float64Array(DCT_SIZE * DCT_SIZE);
		for (let i = 0; i < DCT_SIZE * DCT_SIZE; i++) {
			const idx = i * 4;
			gray[i] = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
		}

		// Apply 2D DCT: first on rows, then on columns
		// Row transform
		const rowDct = new Float64Array(DCT_SIZE * DCT_SIZE);
		for (let y = 0; y < DCT_SIZE; y++) {
			for (let k = 0; k < DCT_SIZE; k++) {
				let sum = 0;
				for (let n = 0; n < DCT_SIZE; n++) {
					sum += DCT_MATRIX[k][n] * gray[y * DCT_SIZE + n];
				}
				rowDct[y * DCT_SIZE + k] = sum;
			}
		}

		// Column transform on the row-transformed result
		const dctCoeffs = new Float64Array(DCT_SIZE * DCT_SIZE);
		for (let x = 0; x < DCT_SIZE; x++) {
			for (let k = 0; k < DCT_SIZE; k++) {
				let sum = 0;
				for (let n = 0; n < DCT_SIZE; n++) {
					sum += DCT_MATRIX[k][n] * rowDct[n * DCT_SIZE + x];
				}
				dctCoeffs[k * DCT_SIZE + x] = sum;
			}
		}

		// Take top-left hashSize×hashSize block (low frequencies), skipping [0][0] (DC component)
		const coeffs: number[] = [];
		for (let y = 0; y < hashSize; y++) {
			for (let x = 0; x < hashSize; x++) {
				if (y === 0 && x === 0) continue; // Skip DC
				coeffs.push(dctCoeffs[y * DCT_SIZE + x]);
			}
		}

		// Median of the coefficients
		const sorted = [...coeffs].sort((a, b) => a - b);
		const median = sorted.length % 2 === 0
			? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
			: sorted[Math.floor(sorted.length / 2)];

		// Generate hash bits: 1 if coefficient > median, else 0
		// Skip DC component at [0][0] and pad to maintain hashSize*hashSize bits
		let hashBits = '';
		for (let y = 0; y < hashSize; y++) {
			for (let x = 0; x < hashSize; x++) {
				if (y === 0 && x === 0) {
					hashBits += '0'; // DC component excluded — always 0
					continue;
				}
				hashBits += dctCoeffs[y * DCT_SIZE + x] > median ? '1' : '0';
			}
		}

		const hexDigits = (hashSize * hashSize) / 4;
		return BigInt('0b' + hashBits)
			.toString(16)
			.padStart(hexDigits, '0');
	},

	hammingDistance(hash1: string, hash2: string): number {
		let distance = 0;
		const a = BigInt('0x' + hash1);
		const b = BigInt('0x' + hash2);
		let xor = a ^ b;
		while (xor > 0n) {
			distance += Number(xor & 1n);
			xor >>= 1n;
		}
		return distance;
	},

	async resizeForUpload(imageBitmap: ImageBitmap, maxDimension = 1024): Promise<Blob> {
		const scale = Math.min(
			1,
			maxDimension / Math.max(imageBitmap.width, imageBitmap.height)
		);
		const w = Math.round(imageBitmap.width * scale);
		const h = Math.round(imageBitmap.height * scale);
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(imageBitmap, 0, 0, w, h);
		return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
	},

	async generateThumbnail(imageBitmap: ImageBitmap, size = 200): Promise<Blob> {
		const aspect = imageBitmap.width / imageBitmap.height;
		const w = aspect > 1 ? size : Math.round(size * aspect);
		const h = aspect > 1 ? Math.round(size / aspect) : size;
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(imageBitmap, 0, 0, w, h);
		return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
	},

	async checkBlurry(imageBitmap: ImageBitmap, threshold = 100): Promise<{ isBlurry: boolean; variance: number }> {
		const canvas = new OffscreenCanvas(200, 150);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(imageBitmap, 0, 0, 200, 150);
		const { data } = ctx.getImageData(0, 0, 200, 150);

		let sum = 0;
		let sumSq = 0;
		let count = 0;

		for (let y = 1; y < 149; y++) {
			for (let x = 1; x < 199; x++) {
				const idx = (y * 200 + x) * 4;
				const gray =
					data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;

				const up =
					data[((y - 1) * 200 + x) * 4] * 0.299 +
					data[((y - 1) * 200 + x) * 4 + 1] * 0.587 +
					data[((y - 1) * 200 + x) * 4 + 2] * 0.114;
				const down =
					data[((y + 1) * 200 + x) * 4] * 0.299 +
					data[((y + 1) * 200 + x) * 4 + 1] * 0.587 +
					data[((y + 1) * 200 + x) * 4 + 2] * 0.114;
				const left =
					data[(y * 200 + x - 1) * 4] * 0.299 +
					data[(y * 200 + x - 1) * 4 + 1] * 0.587 +
					data[(y * 200 + x - 1) * 4 + 2] * 0.114;
				const right =
					data[(y * 200 + x + 1) * 4] * 0.299 +
					data[(y * 200 + x + 1) * 4 + 1] * 0.587 +
					data[(y * 200 + x + 1) * 4 + 2] * 0.114;

				const laplacian = up + down + left + right - 4 * gray;
				sum += laplacian;
				sumSq += laplacian * laplacian;
				count++;
			}
		}

		const mean = sum / count;
		const variance = sumSq / count - mean * mean;
		return { isBlurry: variance < threshold, variance };
	},

	/**
	 * Analyze whether a card is present and sharp in the bracket region.
	 * Uses contrast variance to determine if content (vs blank wall/table) is visible.
	 */
	async analyzeCardPresence(imageBitmap: ImageBitmap, blurThreshold = 100): Promise<{
		cardDetected: boolean;
		isSharp: boolean;
		variance: number;
	}> {
		// Analyze the center 70% of the image (bracket region)
		const analyzeW = 200;
		const analyzeH = 150;
		const canvas = new OffscreenCanvas(analyzeW, analyzeH);
		const ctx = canvas.getContext('2d')!;

		// Crop to center 70%
		const cropX = imageBitmap.width * 0.15;
		const cropY = imageBitmap.height * 0.15;
		const cropW = imageBitmap.width * 0.7;
		const cropH = imageBitmap.height * 0.7;
		ctx.drawImage(imageBitmap, cropX, cropY, cropW, cropH, 0, 0, analyzeW, analyzeH);

		const { data } = ctx.getImageData(0, 0, analyzeW, analyzeH);
		const totalPx = analyzeW * analyzeH;

		// Calculate variance of pixel luminance (high variance = content present)
		let sum = 0;
		let sumSq = 0;
		for (let i = 0; i < totalPx; i++) {
			const idx = i * 4;
			const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
			sum += lum;
			sumSq += lum * lum;
		}
		const mean = sum / totalPx;
		const contentVariance = sumSq / totalPx - mean * mean;

		// Card presence: needs sufficient visual content
		// Lowered from 500 → 300 — mobile cameras in indoor lighting often produce
		// lower variance than expected, especially with matte-finish cards
		const cardDetected = contentVariance > 300;

		// Blur check (Laplacian variance on the same region)
		let lapSum = 0;
		let lapSumSq = 0;
		let lapCount = 0;
		for (let y = 1; y < analyzeH - 1; y++) {
			for (let x = 1; x < analyzeW - 1; x++) {
				const idx = (y * analyzeW + x) * 4;
				const gray = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
				const up = data[((y - 1) * analyzeW + x) * 4] * 0.299 + data[((y - 1) * analyzeW + x) * 4 + 1] * 0.587 + data[((y - 1) * analyzeW + x) * 4 + 2] * 0.114;
				const down = data[((y + 1) * analyzeW + x) * 4] * 0.299 + data[((y + 1) * analyzeW + x) * 4 + 1] * 0.587 + data[((y + 1) * analyzeW + x) * 4 + 2] * 0.114;
				const left = data[(y * analyzeW + x - 1) * 4] * 0.299 + data[(y * analyzeW + x - 1) * 4 + 1] * 0.587 + data[(y * analyzeW + x - 1) * 4 + 2] * 0.114;
				const right = data[(y * analyzeW + x + 1) * 4] * 0.299 + data[(y * analyzeW + x + 1) * 4 + 1] * 0.587 + data[(y * analyzeW + x + 1) * 4 + 2] * 0.114;
				const lap = up + down + left + right - 4 * gray;
				lapSum += lap;
				lapSumSq += lap * lap;
				lapCount++;
			}
		}
		const lapMean = lapSum / lapCount;
		const variance = lapSumSq / lapCount - lapMean * lapMean;
		const isSharp = variance >= blurThreshold;

		return { cardDetected, isSharp, variance };
	},

	/**
	 * Compact image quality report for telemetry.
	 *
	 * Computes blur (Laplacian variance), luminance mean/std, over/underexposed
	 * pixel percentages, and edge density (Sobel-thresholded, not full Canny)
	 * on a 256×192 grayscale downscale. Target budget is <50ms on mobile.
	 *
	 * The `passed` / `failReason` output is a soft guideline, not a gate —
	 * the scan pipeline still runs even when this reports poor quality.
	 */
	async computeQualitySignals(imageBitmap: ImageBitmap): Promise<{
		blur: number;
		luminanceMean: number;
		luminanceStd: number;
		overexposedPct: number;
		underexposedPct: number;
		edgeDensityCanny: number;
		passed: boolean;
		failReason: string | null;
	}> {
		const W = 256;
		const H = 192;
		const canvas = new OffscreenCanvas(W, H);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(imageBitmap, 0, 0, W, H);
		const { data } = ctx.getImageData(0, 0, W, H);
		const total = W * H;

		// Grayscale + luminance histogram in one pass
		const gray = new Float32Array(total);
		let sum = 0;
		let sumSq = 0;
		let over = 0;
		let under = 0;
		for (let i = 0; i < total; i++) {
			const idx = i * 4;
			const g = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
			gray[i] = g;
			sum += g;
			sumSq += g * g;
			if (g > 245) over++;
			else if (g < 10) under++;
		}
		const luminanceMean = sum / total;
		const luminanceStd = Math.sqrt(Math.max(0, sumSq / total - luminanceMean * luminanceMean));
		const overexposedPct = over / total;
		const underexposedPct = under / total;

		// Laplacian variance (blur). 3×3 kernel, inner pixels only.
		let lapSum = 0;
		let lapSumSq = 0;
		let lapCount = 0;
		for (let y = 1; y < H - 1; y++) {
			for (let x = 1; x < W - 1; x++) {
				const c = gray[y * W + x];
				const lap =
					gray[(y - 1) * W + x] +
					gray[(y + 1) * W + x] +
					gray[y * W + x - 1] +
					gray[y * W + x + 1] -
					4 * c;
				lapSum += lap;
				lapSumSq += lap * lap;
				lapCount++;
			}
		}
		const lapMean = lapSum / lapCount;
		const blur = lapSumSq / lapCount - lapMean * lapMean;

		// Edge density (Sobel magnitude thresholded > 60). Close-enough
		// substitute for a full Canny pass without the hysteresis cost.
		let edgePixels = 0;
		for (let y = 1; y < H - 1; y++) {
			for (let x = 1; x < W - 1; x++) {
				const tl = gray[(y - 1) * W + x - 1];
				const tc = gray[(y - 1) * W + x];
				const tr = gray[(y - 1) * W + x + 1];
				const ml = gray[y * W + x - 1];
				const mr = gray[y * W + x + 1];
				const bl = gray[(y + 1) * W + x - 1];
				const bc = gray[(y + 1) * W + x];
				const br = gray[(y + 1) * W + x + 1];
				const gx = tr + 2 * mr + br - tl - 2 * ml - bl;
				const gy = bl + 2 * bc + br - tl - 2 * tc - tr;
				const mag = Math.sqrt(gx * gx + gy * gy);
				if (mag > 60) edgePixels++;
			}
		}
		const edgeDensityCanny = edgePixels / ((W - 2) * (H - 2));

		// Soft quality gate — advisory only.
		let passed = true;
		let failReason: string | null = null;
		if (blur < 80) {
			passed = false;
			failReason = 'blur';
		} else if (overexposedPct > 0.4) {
			passed = false;
			failReason = 'overexposed';
		} else if (underexposedPct > 0.4) {
			passed = false;
			failReason = 'underexposed';
		} else if (luminanceMean < 30 || luminanceMean > 230) {
			passed = false;
			failReason = 'lighting';
		}

		return {
			blur,
			luminanceMean,
			luminanceStd,
			overexposedPct,
			underexposedPct,
			edgeDensityCanny,
			passed,
			failReason
		};
	},

	async checkGlare(imageBitmap: ImageBitmap, brightnessThreshold = 240, areaThreshold = 0.03): Promise<{ hasGlare: boolean; regions: Array<{ x: number; y: number; w: number; h: number }> }> {
		const analyzeW = 200;
		const analyzeH = 150;
		const canvas = new OffscreenCanvas(analyzeW, analyzeH);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(imageBitmap, 0, 0, analyzeW, analyzeH);
		const { data } = ctx.getImageData(0, 0, analyzeW, analyzeH);

		// Find bright pixels (potential glare)
		const bright = new Uint8Array(analyzeW * analyzeH);
		let brightCount = 0;
		for (let i = 0; i < analyzeW * analyzeH; i++) {
			const idx = i * 4;
			const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
			if (lum > brightnessThreshold) {
				bright[i] = 1;
				brightCount++;
			}
		}

		const totalPixels = analyzeW * analyzeH;
		const hasGlare = brightCount / totalPixels > areaThreshold;

		// Simple region detection: find bounding boxes of bright clusters using grid cells
		const regions: Array<{ x: number; y: number; w: number; h: number }> = [];
		if (hasGlare) {
			const cellW = 40;
			const cellH = 30;
			for (let cy = 0; cy < analyzeH; cy += cellH) {
				for (let cx = 0; cx < analyzeW; cx += cellW) {
					let cellBright = 0;
					const cw = Math.min(cellW, analyzeW - cx);
					const ch = Math.min(cellH, analyzeH - cy);
					for (let y = cy; y < cy + ch; y++) {
						for (let x = cx; x < cx + cw; x++) {
							if (bright[y * analyzeW + x]) cellBright++;
						}
					}
					if (cellBright / (cw * ch) > 0.3) {
						regions.push({
							x: cx / analyzeW,
							y: cy / analyzeH,
							w: cw / analyzeW,
							h: ch / analyzeH
						});
					}
				}
			}
		}

		return { hasGlare, regions };
	},

	async preprocessForOCR(imageBitmap: ImageBitmap, region: OcrRegion): Promise<Blob> {
		const sw = imageBitmap.width;
		const sh = imageBitmap.height;
		const sx = Math.floor(sw * region.x);
		const sy = Math.floor(sh * region.y);
		let sw2 = Math.floor(sw * region.w);
		let sh2 = Math.floor(sh * region.h);

		// Clamp crop to image bounds
		sw2 = Math.min(sw2, sw - sx);
		sh2 = Math.min(sh2, sh - sy);

		// Tesseract needs at least 3px in each dimension to process lines
		const MIN_CROP = 3;
		if (sw2 < MIN_CROP || sh2 < MIN_CROP) {
			throw new Error(`OCR region too small: ${sw2}x${sh2} (min ${MIN_CROP}x${MIN_CROP})`);
		}

		// Scale up for crisper character rendering, ensure at least 30px in each dimension
		const SCALE = Math.max(4, Math.ceil(30 / Math.min(sw2, sh2)));
		const canvas = new OffscreenCanvas(sw2 * SCALE, sh2 * SCALE);
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(imageBitmap, sx, sy, sw2, sh2, 0, 0, canvas.width, canvas.height);

		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const data = imageData.data;
		const w = canvas.width;
		const h = canvas.height;
		const totalPx = w * h;

		// Histogram stretch (2nd/98th percentile contrast enhancement)
		const hist = new Uint32Array(256);
		for (let i = 0; i < totalPx; i++) {
			const lum = Math.round(
				data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114
			);
			hist[lum]++;
		}
		const p2Count = Math.floor(totalPx * 0.02);
		const p98Count = Math.floor(totalPx * 0.98);
		let cumul = 0,
			lo = -1,
			hi = 255;
		for (let v = 0; v < 256; v++) {
			cumul += hist[v];
			if (cumul >= p2Count && lo === -1) lo = v;
			if (cumul >= p98Count && hi === 255) hi = v;
		}
		if (lo === -1) lo = 0;
		const range = Math.max(1, hi - lo);
		for (let i = 0; i < totalPx; i++) {
			const idx = i * 4;
			data[idx] = Math.min(255, Math.max(0, Math.round(((data[idx] - lo) * 255) / range)));
			data[idx + 1] = Math.min(
				255,
				Math.max(0, Math.round(((data[idx + 1] - lo) * 255) / range))
			);
			data[idx + 2] = Math.min(
				255,
				Math.max(0, Math.round(((data[idx + 2] - lo) * 255) / range))
			);
		}

		// Grayscale conversion
		const gray = new Uint8Array(totalPx);
		for (let i = 0; i < totalPx; i++) {
			gray[i] = Math.round(
				data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114
			);
		}

		// Apply contrast boost: threshold at 128 on grayscale for cleaner OCR input
		for (let i = 0; i < totalPx; i++) {
			const v = gray[i];
			// Sigmoid contrast curve centered at 128
			const boosted = 255 / (1 + Math.exp(-0.05 * (v - 128)));
			gray[i] = Math.round(boosted);
		}

		// Unsharp mask (3x3 Laplacian sharpening)
		const sharpened = new Uint8Array(totalPx);
		const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let ksum = 0;
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						const ny = Math.min(h - 1, Math.max(0, y + dy));
						const nx = Math.min(w - 1, Math.max(0, x + dx));
						ksum += gray[ny * w + nx] * kernel[(dy + 1) * 3 + (dx + 1)];
					}
				}
				sharpened[y * w + x] = Math.min(255, Math.max(0, ksum));
			}
		}

		// Adaptive threshold (integral-image method)
		const integral = new Float64Array((w + 1) * (h + 1));
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				integral[(y + 1) * (w + 1) + (x + 1)] =
					sharpened[y * w + x] +
					integral[y * (w + 1) + (x + 1)] +
					integral[(y + 1) * (w + 1) + x] -
					integral[y * (w + 1) + x];
			}
		}

		const half = 10;
		const C = 10;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const x1 = Math.max(0, x - half);
				const y1 = Math.max(0, y - half);
				const x2 = Math.min(w, x + half + 1);
				const y2 = Math.min(h, y + half + 1);
				const n = (x2 - x1) * (y2 - y1);
				const areaSum =
					integral[y2 * (w + 1) + x2] -
					integral[y1 * (w + 1) + x2] -
					integral[y2 * (w + 1) + x1] +
					integral[y1 * (w + 1) + x1];
				const val = sharpened[y * w + x] < areaSum / n - C ? 0 : 255;
				const idx = (y * w + x) * 4;
				data[idx] = data[idx + 1] = data[idx + 2] = val;
				data[idx + 3] = 255;
			}
		}

		ctx.putImageData(imageData, 0, 0);

		// Check if the thresholded image has enough dark (text) pixels.
		// If the region is nearly all-white after binarisation, there's no text
		// to recognise — skip early to avoid Tesseract internal warnings
		// ("ridiculously small scaling factor", "Image too small to scale").
		let darkPixels = 0;
		for (let i = 0; i < totalPx; i++) {
			if (data[i * 4] === 0) darkPixels++;
		}
		const darkRatio = darkPixels / totalPx;
		if (darkRatio < 0.005 || darkRatio > 0.95) {
			throw new Error(
				`OCR region has no usable text content (dark pixel ratio: ${(darkRatio * 100).toFixed(1)}%)`
			);
		}

		return canvas.convertToBlob({ type: 'image/png' });
	},

	/**
	 * Detect the card quadrilateral in a photo and perspective-correct it
	 * to a canonical 500×700 bitmap. Returns a RectifyResult — either with
	 * a warped bitmap (success) or bitmap: null (failure). Diagnostic is
	 * always populated so the caller can write rectification_attempt.
	 *
	 * Pipeline: grayscale → Gaussian blur → Canny → dilate → findContours
	 * → scoring-based quad selection → getPerspectiveTransform +
	 * warpPerspective.
	 *
	 * Quad selection is scoring-based: area, aspect proximity to 0.714,
	 * corner orthogonality, convexity — no hard rejects. The highest-scoring
	 * quad above a minimum threshold wins. Replaces the prior hard-threshold
	 * filter that rejected most tilted phone captures.
	 *
	 * Internal 2s budget with early exit on each stage. No outer Promise.race:
	 * the internal checkpoints force completion within budget.
	 *
	 * OpenCV.js is dynamically imported on first call (~2MB WASM, one-time
	 * cost per session).
	 */
	async rectifyCard(bitmap: ImageBitmap): Promise<RectifyResult> {
		// No outer Promise.race — internal budget checkpoints handle timing.
		// Guaranteed to return within ~2.5s under normal circumstances.
		return this._rectifyCardInner(bitmap);
	},

	async _rectifyCardInner(bitmap: ImageBitmap): Promise<RectifyResult> {
		const startTime = performance.now();
		const BUDGET_MS = 2000;

		const diagnostic: RectifyDiagnostic = {
			succeeded: false,
			fail_reason: null,
			total_ms: 0,
			src_width: bitmap.width,
			src_height: bitmap.height,
			contour_count: 0,
			quad_count: 0,
			viable_quad_count: 0,
			best_quad: null,
			timings: {
				gray_ms: 0,
				blur_ms: 0,
				canny_ms: 0,
				dilate_ms: 0,
				contour_ms: 0,
				approx_ms: 0,
				warp_ms: 0
			}
		};

		const finalize = (): void => {
			diagnostic.total_ms = Math.round(performance.now() - startTime);
		};

		const checkBudget = (stage: string): boolean => {
			if (performance.now() - startTime > BUDGET_MS) {
				diagnostic.fail_reason = `timeout_${stage}`;
				finalize();
				return false;
			}
			return true;
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let cv: any;
		try {
			cv = await loadOpenCV();
		} catch (err) {
			diagnostic.fail_reason = `opencv_load: ${err instanceof Error ? err.message : String(err)}`;
			finalize();
			return { bitmap: null, diagnostic };
		}

		// Track every Mat we allocate (except quad candidates, which we own
		// individually) so the cleanup path can release them. OpenCV.js wraps
		// emscripten heap memory — forgetting delete() leaks.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const mats: Array<any> = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let contours: any = null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const scoredQuads: Array<{
			quad: any;
			score: number;
			area_ratio: number;
			aspect: number;
			points: Array<{ x: number; y: number }>;
			convex: boolean;
			corner_dev: number;
		}> = [];

		const cleanup = (): void => {
			for (const sq of scoredQuads) {
				if (sq.quad && typeof sq.quad.delete === 'function') {
					try { sq.quad.delete(); } catch { /* ignore */ }
				}
			}
			if (contours && typeof contours.delete === 'function') {
				try { contours.delete(); } catch { /* ignore */ }
			}
			cleanupMats(mats);
		};

		try {
			const src = bitmapToMat(cv, bitmap);
			mats.push(src);
			const imageArea = src.rows * src.cols;

			// === Gray ===
			if (!checkBudget('pre_gray')) { cleanup(); return { bitmap: null, diagnostic }; }
			const t0 = performance.now();
			const gray = new cv.Mat();
			mats.push(gray);
			cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
			diagnostic.timings.gray_ms = Math.round(performance.now() - t0);

			// === Blur ===
			if (!checkBudget('pre_blur')) { cleanup(); return { bitmap: null, diagnostic }; }
			const t1 = performance.now();
			cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
			diagnostic.timings.blur_ms = Math.round(performance.now() - t1);

			// === Canny ===
			// Looser thresholds (40/150 vs prior 75/200) for phone photos with
			// moderate glare/shadow. The prior tuning was for clean scan data.
			if (!checkBudget('pre_canny')) { cleanup(); return { bitmap: null, diagnostic }; }
			const t2 = performance.now();
			const edges = new cv.Mat();
			mats.push(edges);
			cv.Canny(gray, edges, 40, 150);
			diagnostic.timings.canny_ms = Math.round(performance.now() - t2);

			// === Dilate (close small edge gaps) ===
			if (!checkBudget('pre_dilate')) { cleanup(); return { bitmap: null, diagnostic }; }
			const t3 = performance.now();
			const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
			mats.push(kernel);
			cv.dilate(edges, edges, kernel);
			diagnostic.timings.dilate_ms = Math.round(performance.now() - t3);

			// === Find contours ===
			if (!checkBudget('pre_contour')) { cleanup(); return { bitmap: null, diagnostic }; }
			const t4 = performance.now();
			contours = new cv.MatVector();
			const hierarchy = new cv.Mat();
			mats.push(hierarchy);
			cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
			diagnostic.contour_count = contours.size();
			diagnostic.timings.contour_ms = Math.round(performance.now() - t4);

			// === Score each contour that reduces to a quad ===
			// Cap iteration count. Pathological inputs (e.g., heavy texture)
			// can produce thousands of contours — pre-sort by area and examine
			// only the 50 largest. Anything a card would appear in is in that set.
			if (!checkBudget('pre_approx')) { cleanup(); return { bitmap: null, diagnostic }; }
			const t5 = performance.now();
			const MAX_CONTOURS_TO_EXAMINE = 50;
			const contourIndices: Array<{ idx: number; area: number }> = [];
			for (let i = 0; i < contours.size(); i++) {
				const c = contours.get(i);
				const area = cv.contourArea(c);
				c.delete();
				// Filter out trivially-small contours (<2% of frame). Purely a
				// budget optimization — anything that small would score near 0.
				if (area < imageArea * 0.02) continue;
				contourIndices.push({ idx: i, area });
			}
			contourIndices.sort((a, b) => b.area - a.area);
			const examine = contourIndices.slice(0, MAX_CONTOURS_TO_EXAMINE);

			for (let loopIdx = 0; loopIdx < examine.length; loopIdx++) {
				if (!checkBudget(`approx_${loopIdx}`)) break;

				const { idx, area } = examine[loopIdx];
				const contour = contours.get(idx);
				const peri = cv.arcLength(contour, true);
				const approx = new cv.Mat();
				cv.approxPolyDP(contour, approx, 0.02 * peri, true);
				contour.delete();

				if (approx.rows !== 4) {
					approx.delete();
					continue;
				}

				diagnostic.quad_count += 1;
				const points = extractCorners(approx);
				const ordered = orderCornersClockwise(points);
				const aspect = quadAspectRatio(ordered);
				const area_ratio = area / imageArea;

				// Scoring: each criterion contributes 0..1, weighted sum.
				// Area ≥10% full marks; ramps to 0 at 2%.
				const areaScore = Math.min(1, Math.max(0, (area_ratio - 0.02) / 0.08));
				// Aspect proximity to 0.714 (2.5:3.5). ±0.05 full marks; ±0.20 → 0.
				const aspectDelta = Math.abs(aspect - 0.714);
				const aspectScore = Math.min(1, Math.max(0, 1 - (aspectDelta - 0.05) / 0.15));
				// Corner orthogonality. 0° deviation full marks; 30° → 0.
				const corner_dev = averageCornerDeviation(ordered);
				const orthoScore = Math.min(1, Math.max(0, 1 - corner_dev / 30));
				// Convexity: real cards are convex quads.
				const convex = cv.isContourConvex(approx);
				const convexScore = convex ? 1 : 0;

				const score =
					areaScore * 0.35 + aspectScore * 0.35 + orthoScore * 0.20 + convexScore * 0.10;

				scoredQuads.push({ quad: approx, score, area_ratio, aspect, points: ordered, convex, corner_dev });
				if (score >= 0.5) diagnostic.viable_quad_count += 1;
			}
			diagnostic.timings.approx_ms = Math.round(performance.now() - t5);

			if (scoredQuads.length === 0) {
				diagnostic.fail_reason = diagnostic.contour_count === 0 ? 'no_contours' : 'no_quads';
				finalize();
				cleanup();
				return { bitmap: null, diagnostic };
			}

			scoredQuads.sort((a, b) => b.score - a.score);
			const best = scoredQuads[0];
			diagnostic.best_quad = {
				area_ratio: best.area_ratio,
				aspect: best.aspect,
				score: best.score,
				chosen: false,
				reject_reason: null,
				points: best.points
			};

			// Minimum score threshold. Permissive: accepts tilted phone captures
			// with moderate glare. Tune based on rectification_attempt data.
			const MIN_ACCEPT_SCORE = 0.45;
			if (best.score < MIN_ACCEPT_SCORE) {
				diagnostic.fail_reason = 'no_valid_quad';
				diagnostic.best_quad.reject_reason =
					`score_${best.score.toFixed(2)}_below_${MIN_ACCEPT_SCORE}`;
				finalize();
				cleanup();
				return { bitmap: null, diagnostic };
			}

			// === Warp ===
			if (!checkBudget('pre_warp')) { cleanup(); return { bitmap: null, diagnostic }; }
			const t6 = performance.now();
			const CANONICAL_W = 500;
			const CANONICAL_H = 700;
			const srcCorners = cv.matFromArray(
				4, 1, cv.CV_32FC2,
				best.points.flatMap((p) => [p.x, p.y])
			);
			mats.push(srcCorners);
			const dstCorners = cv.matFromArray(
				4, 1, cv.CV_32FC2,
				[0, 0, CANONICAL_W, 0, CANONICAL_W, CANONICAL_H, 0, CANONICAL_H]
			);
			mats.push(dstCorners);
			const M = cv.getPerspectiveTransform(srcCorners, dstCorners);
			mats.push(M);
			const warped = new cv.Mat();
			mats.push(warped);
			cv.warpPerspective(src, warped, M, new cv.Size(CANONICAL_W, CANONICAL_H));
			diagnostic.timings.warp_ms = Math.round(performance.now() - t6);

			// Copy warped bytes into an ImageData → OffscreenCanvas → ImageBitmap.
			// Avoids cv.imshow which reaches for document.getElementById in some
			// builds — fragile inside a worker.
			const outCanvas = new OffscreenCanvas(CANONICAL_W, CANONICAL_H);
			const outCtx = outCanvas.getContext('2d')!;
			const imgData = outCtx.createImageData(CANONICAL_W, CANONICAL_H);
			imgData.data.set(warped.data as Uint8Array);
			outCtx.putImageData(imgData, 0, 0);
			const rectifiedBitmap = outCanvas.transferToImageBitmap();

			diagnostic.succeeded = true;
			diagnostic.best_quad.chosen = true;
			finalize();
			cleanup();

			return {
				bitmap: rectifiedBitmap,
				confidence: best.score,
				corners: best.points,
				diagnostic
			};
		} catch (err) {
			diagnostic.fail_reason = `opencv_error: ${err instanceof Error ? err.message : String(err)}`;
			finalize();
			cleanup();
			return { bitmap: null, diagnostic };
		}
	},

	/**
	 * Composite multiple bitmaps using darkest-pixel selection.
	 * Eliminates specular highlights from foil/holographic cards by selecting
	 * the darkest pixel at each position across captures taken at different angles.
	 */
	async compositeMinPixel(bitmaps: ImageBitmap[]): Promise<ImageBitmap> {
		if (bitmaps.length === 0) throw new Error('No bitmaps to composite');
		if (bitmaps.length === 1) return bitmaps[0];

		const w = bitmaps[0].width;
		const h = bitmaps[0].height;
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext('2d')!;

		// Get pixel data from all bitmaps
		const allData: Uint8ClampedArray[] = [];
		for (const bmp of bitmaps) {
			const tmpCanvas = new OffscreenCanvas(w, h);
			const tmpCtx = tmpCanvas.getContext('2d')!;
			tmpCtx.drawImage(bmp, 0, 0, w, h);
			allData.push(tmpCtx.getImageData(0, 0, w, h).data);
		}

		// Create composite: take darkest pixel at each position
		const output = ctx.createImageData(w, h);
		const outData = output.data;
		const totalPixels = w * h * 4;

		for (let i = 0; i < totalPixels; i += 4) {
			let minLum = Infinity;
			let minIdx = 0;
			for (let j = 0; j < allData.length; j++) {
				const lum = allData[j][i] * 0.299 + allData[j][i + 1] * 0.587 + allData[j][i + 2] * 0.114;
				if (lum < minLum) { minLum = lum; minIdx = j; }
			}
			outData[i] = allData[minIdx][i];
			outData[i + 1] = allData[minIdx][i + 1];
			outData[i + 2] = allData[minIdx][i + 2];
			outData[i + 3] = 255;
		}

		ctx.putImageData(output, 0, 0);
		return canvas.transferToImageBitmap();
	}
};

Comlink.expose(imageProcessor);
