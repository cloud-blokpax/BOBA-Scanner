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

/**
 * Canonical crop dimensions. 1500×2100 preserves the 5:7 card aspect and
 * gives Tier 1 canonical PaddleOCR enough resolution to match the 2400px
 * validation target from Phase 2.1a (full-frame fallback scales at most
 * 1.14× from this source). Region OCR with minWidth 800 sees a 675px-wide
 * card-number strip — effectively a 1.19× resize, not the 3.56× upscale it
 * was doing at 500×700.
 *
 * Hash and embedding tiers resize internally to 9×8 / 32×32 / DINOv2 input
 * sizes, so this change is a no-op for them.
 *
 * On cameras capped at 1280×720 (older Android), this means the OCR path
 * receives a mild upscale from the viewfinder crop. Still strictly better
 * than the pre-change behavior where the 500×700 canonical was upscaled
 * again inside region OCR.
 */
export const CANONICAL_CROP_WIDTH = 1500;
export const CANONICAL_CROP_HEIGHT = 2100;

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
