/**
 * Constrained-capture crop.
 *
 * Because the user aligns the card to the viewfinder before capturing, the
 * captured bitmap has the card in a known region. This function crops to
 * that region and resizes to a canonical size for downstream processing
 * (Tier 1 hash today, Tier 1 embedding in Session 1.6).
 *
 * Replaces the OpenCV rectification pipeline entirely. Runs main-thread in
 * ~5ms via Canvas 2D drawImage(source-rect → dest-rect).
 */

export interface ViewfinderRect {
	/** Top-left X in the SOURCE bitmap's coordinate space (pixels) */
	x: number;
	/** Top-left Y in the SOURCE bitmap's coordinate space (pixels) */
	y: number;
	/** Width in source pixels */
	width: number;
	/** Height in source pixels */
	height: number;
}

/** Canonical crop dimensions. 500×700 ≈ card aspect 0.714, large enough for hash/embedding. */
export const CANONICAL_CROP_WIDTH = 500;
export const CANONICAL_CROP_HEIGHT = 700;

/**
 * Crop the bitmap to the viewfinder region and resize to canonical dimensions.
 * Never throws; falls back to a centered crop if the rect is invalid.
 */
export async function cropToCanonical(
	bitmap: ImageBitmap,
	viewfinder: ViewfinderRect
): Promise<ImageBitmap> {
	const { x, y, width, height } = sanitizeViewfinder(viewfinder, bitmap.width, bitmap.height);
	const canvas = new OffscreenCanvas(CANONICAL_CROP_WIDTH, CANONICAL_CROP_HEIGHT);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Failed to acquire 2d context');
	ctx.drawImage(
		bitmap,
		x, y, width, height,
		0, 0, CANONICAL_CROP_WIDTH, CANONICAL_CROP_HEIGHT
	);
	return canvas.transferToImageBitmap();
}

function sanitizeViewfinder(
	vf: ViewfinderRect,
	srcW: number,
	srcH: number
): ViewfinderRect {
	// Safety net: fall back to a centered card-aspect crop occupying ~85% of
	// the smaller dimension if the incoming rect is broken. In practice
	// Scanner.svelte always passes a real viewfinder rect.
	const invalid = vf.width <= 0 || vf.height <= 0
		|| vf.x < 0 || vf.y < 0
		|| vf.x + vf.width > srcW
		|| vf.y + vf.height > srcH;
	if (!invalid) return vf;
	const aspect = CANONICAL_CROP_WIDTH / CANONICAL_CROP_HEIGHT;
	const height = Math.min(srcH * 0.85, (srcW / aspect) * 0.85);
	const width = height * aspect;
	return {
		x: Math.round((srcW - width) / 2),
		y: Math.round((srcH - height) / 2),
		width: Math.round(width),
		height: Math.round(height)
	};
}
