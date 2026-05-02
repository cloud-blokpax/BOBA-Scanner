/**
 * Phase 1 Doc 1.2 — Orientation Correction
 *
 * Two paths:
 *   1. EXIF orientation applied to uploads before they hit OCR. Trusts the
 *      camera's recorded orientation tag.
 *   2. 180°-retry safety net: if Tier 1 OCR returns below the confidence
 *      floor on BOTH card_number and name regions, retry on the bitmap
 *      rotated 180° and pick whichever pass scored higher.
 *
 * 90°/270° retries are NOT included by default — almost no phone capture
 * arrives sideways, and the cost of two extra OCR passes per scan is real.
 * If telemetry shows it matters, expand later.
 *
 * Live camera path is unaffected: the viewfinder normalizes orientation at
 * capture time. This module only matters for `imageSource instanceof File`.
 */

export type Rotation = 0 | 90 | 180 | 270;

export const EXIF_ORIENTATION_TO_ROTATION: Record<number, Rotation> = {
	1: 0,   // Horizontal (normal)
	3: 180, // Rotate 180
	6: 90,  // Rotate 90 CW
	8: 270  // Rotate 270 CW
	// Mirrored variants (2, 4, 5, 7) treated as 0; they're rare and the
	// mirror correction would change pixel content in a way that affects
	// recognition — punt on those for Phase 1.
};

/**
 * Map an EXIF orientation tag (1-8) to the rotation we should apply to the
 * raw bitmap so it ends up "right side up" for OCR. Returns 0 for unknown
 * or normal orientation.
 */
export function rotationFromExif(exifOrientation: number | null | undefined): Rotation {
	if (exifOrientation == null) return 0;
	return EXIF_ORIENTATION_TO_ROTATION[exifOrientation] ?? 0;
}

/**
 * Rotate an ImageBitmap by a multiple of 90°, returning a fresh ImageBitmap.
 * Caller owns both the input and the returned bitmap; the input is NOT
 * closed by this function.
 */
export async function rotateBitmap(
	bitmap: ImageBitmap,
	deg: Rotation
): Promise<ImageBitmap> {
	if (deg === 0) {
		// Return a clone so callers can uniformly close() the result.
		const c = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = c.getContext('2d');
		if (!ctx) throw new Error('2D context unavailable');
		ctx.drawImage(bitmap, 0, 0);
		return c.transferToImageBitmap();
	}
	const swap = deg === 90 || deg === 270;
	const w = swap ? bitmap.height : bitmap.width;
	const h = swap ? bitmap.width : bitmap.height;
	const c = new OffscreenCanvas(w, h);
	const ctx = c.getContext('2d');
	if (!ctx) throw new Error('2D context unavailable');
	ctx.translate(w / 2, h / 2);
	ctx.rotate((deg * Math.PI) / 180);
	ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
	return c.transferToImageBitmap();
}
