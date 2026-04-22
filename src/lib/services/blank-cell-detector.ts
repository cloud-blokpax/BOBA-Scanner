/**
 * Cheap classifier for blank (card-less) binder cells. Saves OCR cycles
 * per cycle × per cell. Fail-open — uncertainty is treated as non-blank
 * and OCR runs anyway, so a false positive is a cost miss, never a
 * scan miss.
 *
 * Signals:
 *   - Edge density: a card has sharp letter / number / art edges, an
 *     empty sleeve does not.
 *   - Color variance: an empty sleeve's color distribution is narrow
 *     (uniform plastic + backing), a card's is wide.
 */

const DOWNSAMPLE = 32;

export async function isCellBlank(bitmap: ImageBitmap): Promise<boolean> {
	const W = DOWNSAMPLE;
	const H = Math.round(DOWNSAMPLE * 1.4);
	const canvas = new OffscreenCanvas(W, H);
	const ctx = canvas.getContext('2d');
	if (!ctx) return false;

	ctx.drawImage(bitmap, 0, 0, W, H);
	const img = ctx.getImageData(0, 0, W, H).data;

	let edgeSum = 0;
	let rSum = 0,
		gSum = 0,
		bSum = 0;
	let rSqSum = 0,
		gSqSum = 0,
		bSqSum = 0;
	let n = 0;

	for (let y = 1; y < H - 1; y++) {
		for (let x = 1; x < W - 1; x++) {
			const i = (y * W + x) * 4;
			const rx = (y * W + (x + 1)) * 4;
			const by = ((y + 1) * W + x) * 4;
			const dx = img[rx] - img[i];
			const dy = img[by] - img[i];
			edgeSum += Math.abs(dx) + Math.abs(dy);

			rSum += img[i];
			gSum += img[i + 1];
			bSum += img[i + 2];
			rSqSum += img[i] * img[i];
			gSqSum += img[i + 1] * img[i + 1];
			bSqSum += img[i + 2] * img[i + 2];
			n++;
		}
	}

	const edgeDensity = edgeSum / n;
	const variance =
		(rSqSum / n - (rSum / n) * (rSum / n)) +
		(gSqSum / n - (gSum / n) * (gSum / n)) +
		(bSqSum / n - (bSum / n) * (bSum / n));

	const BLANK_EDGE_MAX = 8;
	const BLANK_VARIANCE_MAX = 800;
	return edgeDensity < BLANK_EDGE_MAX && variance < BLANK_VARIANCE_MAX;
}
