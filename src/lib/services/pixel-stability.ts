/**
 * Per-frame pixel stability check.
 *
 * Used to detect card swaps that happen within a single "ready" alignment
 * state — the alignment classifier can't see a fast hand switch, but a
 * normalized cross-correlation on downsampled frames can.
 */

const PROBE_W = 64;
const PROBE_H = 96;

export function makeProbe(bitmap: ImageBitmap): Uint8Array {
	const canvas = new OffscreenCanvas(PROBE_W, PROBE_H);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('no 2d context');
	ctx.drawImage(bitmap, 0, 0, PROBE_W, PROBE_H);
	const img = ctx.getImageData(0, 0, PROBE_W, PROBE_H);
	const gray = new Uint8Array(PROBE_W * PROBE_H);
	for (let i = 0; i < PROBE_W * PROBE_H; i++) {
		gray[i] =
			(img.data[i * 4] * 0.299 + img.data[i * 4 + 1] * 0.587 + img.data[i * 4 + 2] * 0.114) | 0;
	}
	return gray;
}

/**
 * Normalized cross-correlation between two probes.
 * Returns [0..1], where 1 = identical, ~0.85+ = same card with minor motion,
 * <0.75 = likely different card or major scene change.
 */
export function correlate(a: Uint8Array, b: Uint8Array): number {
	if (a.length !== b.length) return 0;
	const n = a.length;
	let sumA = 0;
	let sumB = 0;
	for (let i = 0; i < n; i++) {
		sumA += a[i];
		sumB += b[i];
	}
	const meanA = sumA / n;
	const meanB = sumB / n;
	let num = 0;
	let denA = 0;
	let denB = 0;
	for (let i = 0; i < n; i++) {
		const da = a[i] - meanA;
		const db = b[i] - meanB;
		num += da * db;
		denA += da * da;
		denB += db * db;
	}
	const den = Math.sqrt(denA * denB);
	return den > 0 ? Math.max(0, num / den) : 0;
}

export const STABILITY_THRESHOLD = 0.85;
