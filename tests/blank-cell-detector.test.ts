/**
 * Unit tests for the pure blank-cell classifier that gates OCR
 * work inside binder-mode. The ImageBitmap-consuming wrapper
 * (isCellBlank) is covered in integration tests.
 */
import { describe, it, expect } from 'vitest';
import { classifyBlankFromPixels } from '../src/lib/services/blank-cell-detector';

// Build a synthetic 32×45 RGBA pixel buffer (matches the function's
// DOWNSAMPLE constants). Each test produces a different fill pattern.
function makePixels(
	width: number,
	height: number,
	fill: (x: number, y: number) => [number, number, number]
): Uint8ClampedArray {
	const buf = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const [r, g, b] = fill(x, y);
			buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
		}
	}
	return buf;
}

describe('classifyBlankFromPixels', () => {
	const W = 32;
	const H = 45;

	it('classifies a flat-gray cell as blank', () => {
		const pixels = makePixels(W, H, () => [128, 128, 128]);
		expect(classifyBlankFromPixels(pixels, W, H)).toBe(true);
	});
	it('classifies a slightly-noisy background as blank (sleeve texture)', () => {
		// Low-amplitude noise simulates an empty plastic sleeve with minor
		// specular variation.
		const pixels = makePixels(W, H, (x, y) => {
			const v = 128 + ((x * 7 + y * 13) % 4); // amplitude 4
			return [v, v, v];
		});
		expect(classifyBlankFromPixels(pixels, W, H)).toBe(true);
	});
	it('classifies a high-contrast striped pattern as NON-blank', () => {
		// Vertical black/white stripes drive edge density + color variance
		// well above the thresholds.
		const pixels = makePixels(W, H, (x) => {
			const v = x % 4 < 2 ? 0 : 255;
			return [v, v, v];
		});
		expect(classifyBlankFromPixels(pixels, W, H)).toBe(false);
	});
	it('classifies random noise as NON-blank', () => {
		let seed = 1;
		const rand = () => {
			seed = (seed * 48271) % 2147483647;
			return seed % 256;
		};
		const pixels = makePixels(W, H, () => [rand(), rand(), rand()]);
		expect(classifyBlankFromPixels(pixels, W, H)).toBe(false);
	});
	it('classifies a sharp vertical edge (card-edge simulation) as NON-blank', () => {
		// Half black, half white — simulates a card's edge bisecting a cell.
		const pixels = makePixels(W, H, (x) => {
			const v = x < W / 2 ? 20 : 240;
			return [v, v, v];
		});
		expect(classifyBlankFromPixels(pixels, W, H)).toBe(false);
	});
	it('classifies a uniform colored cell (solid red sleeve) as blank', () => {
		const pixels = makePixels(W, H, () => [220, 30, 30]);
		expect(classifyBlankFromPixels(pixels, W, H)).toBe(true);
	});
});
