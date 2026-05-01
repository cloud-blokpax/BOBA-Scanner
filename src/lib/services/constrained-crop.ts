/**
 * Canonical card extraction.
 *
 * Two paths:
 *   1. Homography-based perspective warp (NEW, default for all production
 *      callers post-Geometry-Rebuild). Geometrically correct: text that was
 *      skewed becomes horizontal, ocr-regions.ts coords actually correspond
 *      to physical card regions.
 *   2. drawImage rectangular crop (LEGACY, kept only for the
 *      centered_fallback path where no corners were detected).
 *
 * Canonical size 750×1050 = 12 px/mm — research-validated as the right
 * resolution for PaddleOCR rec head on small text. 3mm card-number text
 * becomes ~36 px tall, comfortably above the 24 px reliable-decode floor.
 * The legacy 1500×2100 over-resolved and wasted compute on every region OCR.
 */

import { preloadOpencv } from '$lib/shims/opencv-js';
import { CANONICAL_W, CANONICAL_H } from './upload-card-detector';

export interface ViewfinderRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const CANONICAL_CROP_WIDTH = CANONICAL_W; // 750
export const CANONICAL_CROP_HEIGHT = CANONICAL_H; // 1050

/**
 * Crop the bitmap to the card region. When `homography` is provided,
 * applies cv.warpPerspective for a true rectified canonical. When not,
 * falls back to drawImage rectangular crop.
 *
 * Signature: homography is OPTIONAL so callers that haven't been migrated
 * yet keep working with the legacy path. Production callers (Scanner.svelte,
 * recognition.ts) pass it post-rebuild.
 */
export async function cropToCanonical(
	bitmap: ImageBitmap,
	viewfinder: ViewfinderRect,
	homography?: number[] | null
): Promise<ImageBitmap> {
	if (homography && homography.length === 9) {
		try {
			const warped = await warpPerspectiveToCanonical(bitmap, homography);
			if (warped) return warped;
		} catch (err) {
			console.debug('[constrained-crop] warp failed, falling back to drawImage:', err);
		}
	}
	return drawImageCrop(bitmap, viewfinder);
}

async function warpPerspectiveToCanonical(
	bitmap: ImageBitmap,
	homography: number[]
): Promise<ImageBitmap | null> {
	await preloadOpencv();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cv = (globalThis as any).cv;
	if (!cv?.Mat) return null;

	const sourceCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const sCtx = sourceCanvas.getContext('2d');
	if (!sCtx) return null;
	sCtx.drawImage(bitmap, 0, 0);
	const imageData = sCtx.getImageData(0, 0, bitmap.width, bitmap.height);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let src: any, dst: any, H_mat: any;
	try {
		src = cv.matFromImageData(imageData);
		dst = new cv.Mat();
		H_mat = cv.matFromArray(3, 3, cv.CV_64F, homography);
		const dsize = new cv.Size(CANONICAL_CROP_WIDTH, CANONICAL_CROP_HEIGHT);
		cv.warpPerspective(
			src, dst, H_mat, dsize,
			cv.INTER_CUBIC, cv.BORDER_CONSTANT,
			new cv.Scalar(0, 0, 0, 255)
		);

		const outCanvas = new OffscreenCanvas(CANONICAL_CROP_WIDTH, CANONICAL_CROP_HEIGHT);
		const oCtx = outCanvas.getContext('2d');
		if (!oCtx) return null;

		const out = new ImageData(
			new Uint8ClampedArray(dst.data),
			CANONICAL_CROP_WIDTH,
			CANONICAL_CROP_HEIGHT
		);
		oCtx.putImageData(out, 0, 0);
		return outCanvas.transferToImageBitmap();
	} finally {
		try { src?.delete(); } catch { /* ignore */ }
		try { dst?.delete(); } catch { /* ignore */ }
		try { H_mat?.delete(); } catch { /* ignore */ }
	}
}

async function drawImageCrop(
	bitmap: ImageBitmap,
	viewfinder: ViewfinderRect
): Promise<ImageBitmap> {
	const sx = Math.max(0, Math.round(viewfinder.x));
	const sy = Math.max(0, Math.round(viewfinder.y));
	const sw = Math.max(1, Math.round(viewfinder.width));
	const sh = Math.max(1, Math.round(viewfinder.height));

	const canvas = new OffscreenCanvas(CANONICAL_CROP_WIDTH, CANONICAL_CROP_HEIGHT);
	const ctx = canvas.getContext('2d');
	if (!ctx) {
		return createImageBitmap(bitmap, {
			resizeWidth: CANONICAL_CROP_WIDTH,
			resizeHeight: CANONICAL_CROP_HEIGHT,
			resizeQuality: 'high'
		});
	}
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(
		bitmap,
		sx, sy, sw, sh,
		0, 0, CANONICAL_CROP_WIDTH, CANONICAL_CROP_HEIGHT
	);
	return canvas.transferToImageBitmap();
}
