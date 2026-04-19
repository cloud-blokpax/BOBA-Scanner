/**
 * Server-side dHash and pHash — bit-identical to the client's
 * computeDHash and computePHash in src/lib/workers/image-processor.ts.
 *
 * Parity constraints (see Session 1.0 doc):
 *   - .rotate() to respect EXIF orientation (OffscreenCanvas auto-rotates)
 *   - .toColorspace('srgb') to strip ICC profile (canvas discards it)
 *   - .removeAlpha() so raw buffer is 3 bytes/pixel (RGB, not RGBA)
 *   - fit: 'fill' so resize stretches without aspect preservation (matches
 *     OffscreenCanvas.drawImage(img, 0, 0, w, h))
 *   - BT.601 grayscale weights 0.299 / 0.587 / 0.114 (not sharp's built-in)
 *   - dHash bit: left < right → 1 (same as client)
 *   - pHash bit: coeff > median → 1, DC [0][0] always emitted as '0'
 *
 * The column named `phash` in `hash_cache` stores the dHash (64 bit / 16 hex);
 * the column named `phash_256` stores the real pHash (256 bit / 64 hex). This
 * pre-existing naming is preserved.
 */

import sharp from 'sharp';
import { DCT_SIZE, DCT_MATRIX } from './dct';

/**
 * Compute dHash from an image buffer.
 * Default hashSize=8 → 64 bits → 16 hex chars (matches hash_cache.phash).
 *
 * Algorithm: resize to (hashSize+1) × hashSize, compare each pixel to its
 * right neighbor in grayscale. Bit = 1 if left < right.
 */
export async function computeDHashFromBuffer(
	buffer: Buffer,
	hashSize = 8
): Promise<string> {
	const width = hashSize + 1;
	const height = hashSize;

	const { data } = await sharp(buffer)
		.rotate()
		.resize(width, height, { fit: 'fill' })
		.toColorspace('srgb')
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	let bits = '';
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < hashSize; x++) {
			const leftIdx = (y * width + x) * 3;
			const rightIdx = (y * width + x + 1) * 3;
			const leftGray =
				data[leftIdx] * 0.299 +
				data[leftIdx + 1] * 0.587 +
				data[leftIdx + 2] * 0.114;
			const rightGray =
				data[rightIdx] * 0.299 +
				data[rightIdx + 1] * 0.587 +
				data[rightIdx + 2] * 0.114;
			bits += leftGray < rightGray ? '1' : '0';
		}
	}

	const hexDigits = (hashSize * hashSize) / 4;
	return BigInt('0b' + bits)
		.toString(16)
		.padStart(hexDigits, '0');
}

/**
 * Compute pHash from an image buffer using DCT.
 * Default hashSize=16 → 256 bits → 64 hex chars (matches hash_cache.phash_256).
 *
 * Algorithm:
 *   1. Resize to DCT_SIZE × DCT_SIZE (32×32)
 *   2. Grayscale via BT.601 weights
 *   3. 2D DCT (row then column) using precomputed DCT_MATRIX
 *   4. Take top-left hashSize×hashSize block of coefficients
 *   5. Skip DC component at [0][0] (always emit '0' for it)
 *   6. Threshold remaining coefficients against their median
 *   7. Bit = 1 if coefficient > median
 */
export async function computePHashFromBuffer(
	buffer: Buffer,
	hashSize = 16
): Promise<string> {
	const { data } = await sharp(buffer)
		.rotate()
		.resize(DCT_SIZE, DCT_SIZE, { fit: 'fill' })
		.toColorspace('srgb')
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const gray = new Float64Array(DCT_SIZE * DCT_SIZE);
	for (let i = 0; i < DCT_SIZE * DCT_SIZE; i++) {
		const idx = i * 3;
		gray[i] =
			data[idx] * 0.299 +
			data[idx + 1] * 0.587 +
			data[idx + 2] * 0.114;
	}

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

	const coeffs: number[] = [];
	for (let y = 0; y < hashSize; y++) {
		for (let x = 0; x < hashSize; x++) {
			if (y === 0 && x === 0) continue;
			coeffs.push(dctCoeffs[y * DCT_SIZE + x]);
		}
	}

	const sorted = [...coeffs].sort((a, b) => a - b);
	const median =
		sorted.length % 2 === 0
			? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
			: sorted[Math.floor(sorted.length / 2)];

	let bits = '';
	for (let y = 0; y < hashSize; y++) {
		for (let x = 0; x < hashSize; x++) {
			if (y === 0 && x === 0) {
				bits += '0';
				continue;
			}
			bits += dctCoeffs[y * DCT_SIZE + x] > median ? '1' : '0';
		}
	}

	const hexDigits = (hashSize * hashSize) / 4;
	return BigInt('0b' + bits)
		.toString(16)
		.padStart(hexDigits, '0');
}

/** Hamming distance between two hex hashes of the same length. */
export function hammingDistance(hash1: string, hash2: string): number {
	if (hash1.length !== hash2.length) {
		throw new Error(
			`hash length mismatch: ${hash1.length} vs ${hash2.length}`
		);
	}
	let distance = 0;
	const a = BigInt('0x' + hash1);
	const b = BigInt('0x' + hash2);
	let xor = a ^ b;
	while (xor > 0n) {
		distance += Number(xor & 1n);
		xor >>= 1n;
	}
	return distance;
}
