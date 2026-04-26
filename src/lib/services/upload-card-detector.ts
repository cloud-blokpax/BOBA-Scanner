/**
 * Upload card-rectangle detection.
 *
 * Live capture uses the viewfinder rect to crop the camera frame to a
 * canonical 1500×2100 card frame before any OCR runs. Uploaded photos have
 * no viewfinder — the card is embedded in a larger frame with margins,
 * hands, background, etc. Without a crop step, region-based OCR lands on
 * photo coordinates instead of card coordinates and reads background.
 *
 * This module finds the card's bounding rectangle via Canny edge detection
 * + largest 4-corner contour (with aspect-ratio gating: cards are 5:7 in
 * portrait or 7:5 in landscape). When detection fails (busy background,
 * card filling the frame with no visible edges, low contrast), it falls
 * back to a centered card-aspect crop occupying ~85% of the photo's
 * smaller dimension — matching the existing `sanitizeViewfinder` fallback
 * in `constrained-crop.ts`.
 *
 * OpenCV is already loaded as a transitive dependency of
 * `@gutenye/ocr-browser`; no new bundle cost.
 */

import { preloadOpencv } from '$lib/shims/opencv-js';

export interface CardRect {
	x: number;
	y: number;
	width: number;
	height: number;
	/** Telemetry: 'detected' | 'centered_fallback'. Surfaces in
	 *  `decision_context.upload_card_rect.method` so we can measure
	 *  detection hit rate post-deploy. */
	method: 'detected' | 'centered_fallback';
}

/** Card aspect (5:7 portrait). Used for fallback crop and aspect gating. */
const CARD_ASPECT_PORTRAIT = 5 / 7;
const CARD_ASPECT_LANDSCAPE = 7 / 5;

/** Detection downscale target (long edge). Edge detection on full-res
 *  is wasteful — 800px is more than enough to find the card outline. */
const DETECT_LONG_EDGE = 800;

/** A contour must occupy at least this fraction of the image to be a
 *  candidate. Filters out background clutter and small UI elements. */
const MIN_AREA_FRAC = 0.15;

/** Aspect ratio slop on either orientation (±20%). */
const ASPECT_SLOP = 0.20;

export async function detectCardRect(bitmap: ImageBitmap): Promise<CardRect> {
	try {
		await preloadOpencv();
	} catch (err) {
		console.debug('[card-detector] opencv preload failed, using fallback:', err);
		return centeredFallback(bitmap.width, bitmap.height);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cv = (globalThis as any).cv;
	if (!cv?.Mat) {
		console.debug('[card-detector] cv global not ready, using fallback');
		return centeredFallback(bitmap.width, bitmap.height);
	}

	const W = bitmap.width;
	const H = bitmap.height;
	const scale = Math.min(1, DETECT_LONG_EDGE / Math.max(W, H));
	const dw = Math.max(1, Math.round(W * scale));
	const dh = Math.max(1, Math.round(H * scale));

	const canvas = new OffscreenCanvas(dw, dh);
	const ctx = canvas.getContext('2d');
	if (!ctx) return centeredFallback(W, H);
	ctx.drawImage(bitmap, 0, 0, dw, dh);
	const imageData = ctx.getImageData(0, 0, dw, dh);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let src: any, gray: any, blurred: any, edges: any, kernel: any, contours: any, hierarchy: any;
	try {
		src = cv.matFromImageData(imageData);
		gray = new cv.Mat();
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

		blurred = new cv.Mat();
		cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

		edges = new cv.Mat();
		cv.Canny(blurred, edges, 75, 200);

		// Dilate to bridge small gaps in detected edges (cards on busy
		// surfaces often have broken outlines from glare or shadows).
		kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
		cv.dilate(edges, edges, kernel);

		contours = new cv.MatVector();
		hierarchy = new cv.Mat();
		cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

		const minArea = dw * dh * MIN_AREA_FRAC;
		let bestRect: { x: number; y: number; width: number; height: number } | null = null;
		let bestArea = 0;

		const n = contours.size();
		for (let i = 0; i < n; i++) {
			const c = contours.get(i);
			const area = cv.contourArea(c);
			if (area < minArea) {
				c.delete();
				continue;
			}

			const peri = cv.arcLength(c, true);
			const approx = new cv.Mat();
			cv.approxPolyDP(c, approx, 0.02 * peri, true);

			// Accept 4–8 vertex polygons. Cards have 4 corners but rounded
			// corners + Canny noise often produce 5–8 vertices. The bounding
			// rect is what we want anyway.
			const verts = approx.rows;
			if (verts >= 4 && verts <= 8) {
				const rect = cv.boundingRect(approx);
				const aspect = rect.width / rect.height;
				const portraitOK =
					aspect >= CARD_ASPECT_PORTRAIT * (1 - ASPECT_SLOP) &&
					aspect <= CARD_ASPECT_PORTRAIT * (1 + ASPECT_SLOP);
				const landscapeOK =
					aspect >= CARD_ASPECT_LANDSCAPE * (1 - ASPECT_SLOP) &&
					aspect <= CARD_ASPECT_LANDSCAPE * (1 + ASPECT_SLOP);
				if ((portraitOK || landscapeOK) && area > bestArea) {
					bestArea = area;
					bestRect = {
						x: Math.round(rect.x / scale),
						y: Math.round(rect.y / scale),
						width: Math.round(rect.width / scale),
						height: Math.round(rect.height / scale)
					};
				}
			}

			approx.delete();
			c.delete();
		}

		if (!bestRect) return centeredFallback(W, H);

		// Tiny inset to shave shadows/glare just inside the card edge —
		// the OCR regions have their own padding, so erring slightly inward
		// is safe and avoids OCR seeing background pixels along the border.
		const insetX = Math.round(bestRect.width * 0.01);
		const insetY = Math.round(bestRect.height * 0.01);
		return {
			x: bestRect.x + insetX,
			y: bestRect.y + insetY,
			width: bestRect.width - 2 * insetX,
			height: bestRect.height - 2 * insetY,
			method: 'detected'
		};
	} catch (err) {
		console.debug('[card-detector] threw, using fallback:', err);
		return centeredFallback(W, H);
	} finally {
		// OpenCV.js requires explicit Mat.delete() to free the WASM heap.
		// Wrapping each in try/catch because some refs may be undefined if
		// allocation threw before the assignment.
		try { src?.delete(); } catch { /* ignore */ }
		try { gray?.delete(); } catch { /* ignore */ }
		try { blurred?.delete(); } catch { /* ignore */ }
		try { edges?.delete(); } catch { /* ignore */ }
		try { kernel?.delete(); } catch { /* ignore */ }
		try { contours?.delete(); } catch { /* ignore */ }
		try { hierarchy?.delete(); } catch { /* ignore */ }
	}
}

function centeredFallback(W: number, H: number): CardRect {
	// Centered crop at 5:7 (card aspect), 85% of the smaller-bound dimension.
	// Matches `sanitizeViewfinder` in constrained-crop.ts.
	const photoAspect = W / H;
	let width: number;
	let height: number;
	if (photoAspect > CARD_ASPECT_PORTRAIT) {
		// Photo is wider than card aspect — height-bound.
		height = Math.round(H * 0.85);
		width = Math.round(height * CARD_ASPECT_PORTRAIT);
	} else {
		// Photo is narrower or matches card aspect — width-bound.
		width = Math.round(W * 0.85);
		height = Math.round(width / CARD_ASPECT_PORTRAIT);
	}
	return {
		x: Math.round((W - width) / 2),
		y: Math.round((H - height) / 2),
		width,
		height,
		method: 'centered_fallback'
	};
}
