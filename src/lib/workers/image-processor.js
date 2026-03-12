/**
 * Image Processing Web Worker (runs off main thread)
 *
 * Exposed via Comlink:
 *   - computeDHash(imageBitmap, hashSize) → 16-char hex perceptual hash
 *   - hammingDistance(hash1, hash2) → number
 *   - resizeForUpload(imageBitmap, maxDimension) → Blob
 *   - checkBlurry(imageBitmap, threshold) → { isBlurry, variance }
 *   - cropAndPreprocess(imageBitmap, region) → ImageData (for OCR)
 */
import * as Comlink from 'comlink';

const imageProcessor = {
	/**
	 * Compute dHash (difference hash) for perceptual image matching.
	 * Compares adjacent pixel intensities to produce a rotation/scale-invariant hash.
	 *
	 * @param {ImageBitmap} imageBitmap - Input image
	 * @param {number} hashSize - Hash grid size (default 8 = 64-bit hash)
	 * @returns {string} 16-char hex hash
	 */
	async computeDHash(imageBitmap, hashSize = 8) {
		const canvas = new OffscreenCanvas(hashSize + 1, hashSize);
		const ctx = canvas.getContext('2d');
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
		return BigInt('0b' + hash)
			.toString(16)
			.padStart(hashSize * 2, '0');
	},

	/**
	 * Calculate Hamming distance between two hex hashes.
	 * < 5  = same card
	 * < 10 = similar (variant/foil)
	 * > 15 = different card
	 */
	hammingDistance(hash1, hash2) {
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

	/**
	 * Resize image for upload/API call. Returns JPEG Blob.
	 */
	async resizeForUpload(imageBitmap, maxDimension = 1024) {
		const scale = Math.min(
			1,
			maxDimension / Math.max(imageBitmap.width, imageBitmap.height)
		);
		const w = Math.round(imageBitmap.width * scale);
		const h = Math.round(imageBitmap.height * scale);
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext('2d');
		ctx.drawImage(imageBitmap, 0, 0, w, h);
		return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
	},

	/**
	 * Generate a small thumbnail for collection grid display.
	 */
	async generateThumbnail(imageBitmap, size = 200) {
		const aspect = imageBitmap.width / imageBitmap.height;
		const w = aspect > 1 ? size : Math.round(size * aspect);
		const h = aspect > 1 ? Math.round(size / aspect) : size;
		const canvas = new OffscreenCanvas(w, h);
		const ctx = canvas.getContext('2d');
		ctx.drawImage(imageBitmap, 0, 0, w, h);
		return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
	},

	/**
	 * Check if image is blurry using Laplacian variance.
	 * @param {ImageBitmap} imageBitmap
	 * @param {number} threshold - Variance below this = blurry (default 100)
	 */
	async checkBlurry(imageBitmap, threshold = 100) {
		const canvas = new OffscreenCanvas(200, 150);
		const ctx = canvas.getContext('2d');
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
	 * Crop and preprocess a region for OCR.
	 * Ported from src/core/ocr/ocr.js cropAndPreprocess().
	 * Returns preprocessed ImageData ready for Tesseract.
	 */
	async preprocessForOCR(imageBitmap, region) {
		const sw = imageBitmap.width;
		const sh = imageBitmap.height;
		const sx = Math.floor(sw * region.x);
		const sy = Math.floor(sh * region.y);
		const sw2 = Math.floor(sw * region.w);
		const sh2 = Math.floor(sh * region.h);

		// Scale 4x for crisper character rendering
		const SCALE = 4;
		const canvas = new OffscreenCanvas(sw2 * SCALE, sh2 * SCALE);
		const ctx = canvas.getContext('2d');
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

		// Unsharp mask (3x3 Laplacian sharpening)
		const sharpened = new Uint8Array(totalPx);
		const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let sum = 0;
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						const ny = Math.min(h - 1, Math.max(0, y + dy));
						const nx = Math.min(w - 1, Math.max(0, x + dx));
						sum += gray[ny * w + nx] * kernel[(dy + 1) * 3 + (dx + 1)];
					}
				}
				sharpened[y * w + x] = Math.min(255, Math.max(0, sum));
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
		return canvas.convertToBlob({ type: 'image/png' });
	}
};

Comlink.expose(imageProcessor);
