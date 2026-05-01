/**
 * Card four-corner detection + homography rectification.
 *
 * Used by ALL capture modes (live camera, upload, canonical, binder)
 * post-Geometry-Rebuild. Replaces the legacy bounding-rect detector that
 * never recovered skew on tilted captures and in the bench baseline
 * returned `centered_fallback` even on flat-clean shots — landing OCR ROIs
 * on background table pixels.
 *
 * Pipeline:
 *   1. Downscale source bitmap to DETECT_LONG_EDGE for edge-detection speed.
 *   2. Canny + dilate to bridge edge gaps from glare/shadows.
 *   3. findContours, filter by area >= MIN_AREA_FRAC of the downsampled frame.
 *   4. approxPolyDP with iterating epsilon (0.02 → 0.05) until 4 vertices —
 *      cards have rounded corners that often need 0.03–0.04 to collapse.
 *   5. Order corners TL/TR/BR/BL by (x+y) and (y-x).
 *   6. Validate aspect from average-side-lengths (NOT bounding rect — bbox
 *      under perspective tilts inflates aspect estimate badly).
 *   7. Build 3×3 homography to canonical 750×1050.
 *   8. Compute pxPerMm from detected side lengths / known physical mm.
 *
 * On failure (low contrast, occluded card, OpenCV not loaded), returns a
 * `centered_fallback` with no homography so callers branch to the legacy
 * drawImage path.
 *
 * OpenCV is already a transitive dependency of @gutenye/ocr-browser; no
 * new bundle cost. Mat lifetime discipline: every Mat wrapped in a
 * try/finally .delete() to free the WASM heap.
 */

import { preloadOpencv } from '$lib/shims/opencv-js';

export interface Point {
	x: number;
	y: number;
}

export interface CardDetection {
	/** Original-frame quadrilateral, ordered TL/TR/BR/BL, in source-pixel coords.
	 *  NULL when method === 'centered_fallback'. */
	corners: [Point, Point, Point, Point] | null;

	/** Bounding rect of the detected quad (or fallback rect). Preserved for
	 *  backwards-compat with viewfinder telemetry & UI overlays that draw a box. */
	boundingRect: { x: number; y: number; width: number; height: number };

	/** 3×3 homography flat array (row-major, 9 elements, float64) mapping source frame
	 *  → canonical 750×1050 card. Pass to `cropToCanonical` to apply.
	 *  NULL when method === 'centered_fallback'. */
	homography: number[] | null;

	/** Physical scale of the card surface in the original frame (px / mm).
	 *  Computed from detected side lengths / 63mm or 88mm physical sides.
	 *  NULL when method === 'centered_fallback'. */
	pxPerMm: number | null;

	/** Aspect ratio of the detected quad (long/short), from average side lengths.
	 *  Target: 1.397 (88/63). NULL when method === 'centered_fallback'. */
	aspectRatio: number | null;

	method: 'corner_detected' | 'centered_fallback';

	/**
	 * Which detection layer found the corners (Doc 1.2).
	 * 'canny_75_200' | 'canny_40_120' | 'canny_20_80' | 'adaptive' | null.
	 * Null on centered_fallback.
	 */
	detection_layer?: string | null;
}

/** @deprecated Use CardDetection. Kept as a transition shim — see detectCardRect at bottom. */
export interface CardRect {
	x: number;
	y: number;
	width: number;
	height: number;
	method: 'detected' | 'centered_fallback' | 'corner_detected';
}

const CARD_PHYSICAL_WIDTH_MM = 63;
const CARD_PHYSICAL_HEIGHT_MM = 88;
const CARD_ASPECT = CARD_PHYSICAL_HEIGHT_MM / CARD_PHYSICAL_WIDTH_MM; // 1.3968

export const CANONICAL_W = 750;
export const CANONICAL_H = 1050;

const DETECT_LONG_EDGE_DEFAULT = 800;
const DETECT_LONG_EDGE_LIVE = 600;
const MIN_AREA_FRAC = 0.15;

// Pre-warp aspect tolerance — wide because perspective distortion shrinks
// or stretches detected aspect significantly. Bench evidence: held cards
// at 15–25° tilt produce aspects 1.34–1.52 even when fully visible. The
// gate's only job is to reject obvious non-cards (table edges, book spines,
// phone screens at ~0.56 aspect, posters at >1.7); the post-warp canonical
// is always exactly 1.4 because we force it that way.
const ASPECT_PRE_WARP_MIN = 1.28;
const ASPECT_PRE_WARP_MAX = 1.55;

export interface DetectCardOptions {
	mode?: 'live' | 'upload';
}

export async function detectCard(
	bitmap: ImageBitmap,
	options: DetectCardOptions = {}
): Promise<CardDetection> {
	const detectLongEdge =
		options.mode === 'live' ? DETECT_LONG_EDGE_LIVE : DETECT_LONG_EDGE_DEFAULT;

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
	const scale = Math.min(1, detectLongEdge / Math.max(W, H));
	const dw = Math.max(1, Math.round(W * scale));
	const dh = Math.max(1, Math.round(H * scale));

	const canvas = new OffscreenCanvas(dw, dh);
	const ctx = canvas.getContext('2d');
	if (!ctx) return centeredFallback(W, H);
	ctx.drawImage(bitmap, 0, 0, dw, dh);
	const imageData = ctx.getImageData(0, 0, dw, dh);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let src: any, gray: any, blurred: any, edges: any, kernel: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let contours: any, hierarchy: any;

	try {
		src = cv.matFromImageData(imageData);
		gray = new cv.Mat();
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

		blurred = new cv.Mat();
		cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

		// Doc 1.2 — Layered detection. Try cheapest/sharpest method first;
		// fall back to softer methods if no 4-corner contour emerges.
		// Each layer fully resets edges/contours/hierarchy and reuses the
		// outer-scope Mats so the finally{} cleanup still works.

		edges = new cv.Mat();
		kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
		contours = new cv.MatVector();
		hierarchy = new cv.Mat();

		const minArea = dw * dh * MIN_AREA_FRAC;
		const borderInsetPx = Math.max(2, Math.round(Math.min(dw, dh) * 0.005));

		let bestCorners: [Point, Point, Point, Point] | null = null;
		let detectionLayer: string | null = null;

		// Helper: from a populated `edges` Mat, find the best 4-corner card
		// contour. Mutates `contours` and `hierarchy` (zero'd at start of
		// each call to avoid stale data from previous attempts).
		const findBestCorners = (): [Point, Point, Point, Point] | null => {
			contours.delete();
			contours = new cv.MatVector();
			hierarchy.delete();
			hierarchy = new cv.Mat();
			cv.findContours(
				edges,
				contours,
				hierarchy,
				cv.RETR_EXTERNAL,
				cv.CHAIN_APPROX_SIMPLE
			);

			let best: [Point, Point, Point, Point] | null = null;
			let bestArea = 0;
			const n = contours.size();
			for (let i = 0; i < n; i++) {
				const c = contours.get(i);
				const area = cv.contourArea(c);
				if (area < minArea) {
					c.delete();
					continue;
				}

				// Layer 4 — border-inset filter. Reject contours whose bounding
				// rect touches the frame edge — those are usually the FRAME, not
				// a card centered in it.
				const br = cv.boundingRect(c);
				if (
					br.x < borderInsetPx ||
					br.y < borderInsetPx ||
					br.x + br.width > dw - borderInsetPx ||
					br.y + br.height > dh - borderInsetPx
				) {
					c.delete();
					continue;
				}

				const peri = cv.arcLength(c, true);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				let approx: any = null;
				let found4 = false;
				for (const epsilonFactor of [0.02, 0.03, 0.04, 0.05]) {
					if (approx) approx.delete();
					approx = new cv.Mat();
					cv.approxPolyDP(c, approx, epsilonFactor * peri, true);
					if (approx.rows === 4) {
						found4 = true;
						break;
					}
				}

				if (found4 && approx && area > bestArea) {
					const rawCorners: Point[] = [];
					for (let j = 0; j < 4; j++) {
						rawCorners.push({
							x: approx.data32S[j * 2] / scale,
							y: approx.data32S[j * 2 + 1] / scale
						});
					}
					const ordered = orderCorners(rawCorners);
					const sides = computeSideLengths(ordered);
					const avgLong = (sides.left + sides.right) / 2;
					const avgShort = (sides.top + sides.bottom) / 2;
					const aspect = avgLong / avgShort;
					if (aspect >= ASPECT_PRE_WARP_MIN && aspect <= ASPECT_PRE_WARP_MAX) {
						bestArea = area;
						best = ordered;
					}
				}

				if (approx) approx.delete();
				c.delete();
			}
			return best;
		};

		// Layer 1 — Multi-scale Canny. Three threshold pairs from sharp to soft;
		// each pass dilates onto the same `edges` Mat, accumulating. After each
		// pass, try contour finding. Accept the first pass that yields a valid
		// 4-corner card.
		const cannyThresholds: Array<[number, number]> = [
			[75, 200],   // default — sharp edges, high precision
			[40, 120],   // softer — catches dim edges from glare washouts
			[20, 80]     // softest — last resort, may pick up noise
		];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let cannyOut: any = null;
		try {
			for (const [lo, hi] of cannyThresholds) {
				if (cannyOut) cannyOut.delete();
				cannyOut = new cv.Mat();
				cv.Canny(blurred, cannyOut, lo, hi);
				// OR onto accumulating edges Mat for cumulative coverage.
				if (edges.rows === 0) {
					cannyOut.copyTo(edges);
				} else {
					cv.bitwise_or(edges, cannyOut, edges);
				}
				// Morphological close at each scale: dilate then erode bridges
				// small gaps from occlusion/glare without ballooning real edges.
				cv.dilate(edges, edges, kernel);
				cv.erode(edges, edges, kernel);

				bestCorners = findBestCorners();
				if (bestCorners) {
					detectionLayer = `canny_${lo}_${hi}`;
					break;
				}
			}
		} finally {
			if (cannyOut) cannyOut.delete();
		}

		// Layer 2 — Adaptive thresholding fallback. If Canny found nothing
		// across three scales, try adaptive Gaussian thresholding on the
		// blurred image. Adaptive threshold compares each pixel to its
		// local neighborhood — robust against the uneven lighting from
		// holo glare or shadow.
		if (!bestCorners) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let adaptive: any = null;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let largeKernel: any = null;
			try {
				adaptive = new cv.Mat();
				cv.adaptiveThreshold(
					blurred,
					adaptive,
					255,
					cv.ADAPTIVE_THRESH_GAUSSIAN_C,
					cv.THRESH_BINARY_INV,
					21,
					5
				);
				// Larger morphological kernel for adaptive — its edges are
				// noisier but the "card vs background" structure is more visible.
				largeKernel = cv.getStructuringElement(
					cv.MORPH_RECT,
					new cv.Size(7, 7)
				);
				cv.morphologyEx(adaptive, adaptive, cv.MORPH_CLOSE, largeKernel);

				// Replace edges with adaptive output and try contour finding again.
				edges.delete();
				edges = adaptive.clone();
				bestCorners = findBestCorners();
				if (bestCorners) detectionLayer = 'adaptive';
			} finally {
				if (adaptive) adaptive.delete();
				if (largeKernel) largeKernel.delete();
			}
		}

		if (!bestCorners) return centeredFallback(W, H);

		const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
			bestCorners[0].x, bestCorners[0].y,
			bestCorners[1].x, bestCorners[1].y,
			bestCorners[2].x, bestCorners[2].y,
			bestCorners[3].x, bestCorners[3].y
		]);
		const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
			0, 0,
			CANONICAL_W, 0,
			CANONICAL_W, CANONICAL_H,
			0, CANONICAL_H
		]);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let H_mat: any = null;
		let homography: number[] | null = null;
		try {
			H_mat = cv.getPerspectiveTransform(srcPts, dstPts);
			homography = Array.from(H_mat.data64F as Float64Array);
		} finally {
			srcPts.delete();
			dstPts.delete();
			if (H_mat) H_mat.delete();
		}

		const sides = computeSideLengths(bestCorners);
		const pxPerMmTopBottom = (sides.top + sides.bottom) / 2 / CARD_PHYSICAL_WIDTH_MM;
		const pxPerMmLeftRight = (sides.left + sides.right) / 2 / CARD_PHYSICAL_HEIGHT_MM;
		const pxPerMm = (pxPerMmTopBottom + pxPerMmLeftRight) / 2;
		const aspectRatio =
			(sides.left + sides.right) / 2 / ((sides.top + sides.bottom) / 2);

		const boundingRect = boundingRectFromCorners(bestCorners);

		return {
			corners: bestCorners,
			boundingRect,
			homography,
			pxPerMm,
			aspectRatio,
			method: 'corner_detected',
			detection_layer: detectionLayer
		};
	} catch (err) {
		console.debug('[card-detector] threw, using fallback:', err);
		return centeredFallback(W, H);
	} finally {
		try { src?.delete(); } catch { /* ignore */ }
		try { gray?.delete(); } catch { /* ignore */ }
		try { blurred?.delete(); } catch { /* ignore */ }
		try { edges?.delete(); } catch { /* ignore */ }
		try { kernel?.delete(); } catch { /* ignore */ }
		try { contours?.delete(); } catch { /* ignore */ }
		try { hierarchy?.delete(); } catch { /* ignore */ }
	}
}

/**
 * Order 4 unsorted corners as TL/TR/BR/BL.
 *   TL = min(x+y), BR = max(x+y),
 *   TR = min(y-x), BL = max(y-x).
 */
function orderCorners(pts: Point[]): [Point, Point, Point, Point] {
	if (pts.length !== 4) throw new Error('orderCorners requires 4 points');
	const sums = pts.map((p) => p.x + p.y);
	const diffs = pts.map((p) => p.y - p.x);
	const tlIdx = sums.indexOf(Math.min(...sums));
	const brIdx = sums.indexOf(Math.max(...sums));
	const trIdx = diffs.indexOf(Math.min(...diffs));
	const blIdx = diffs.indexOf(Math.max(...diffs));
	return [pts[tlIdx], pts[trIdx], pts[brIdx], pts[blIdx]];
}

interface SideLengths {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

function computeSideLengths(c: [Point, Point, Point, Point]): SideLengths {
	const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
	return {
		top: dist(c[0], c[1]),
		right: dist(c[1], c[2]),
		bottom: dist(c[2], c[3]),
		left: dist(c[3], c[0])
	};
}

function boundingRectFromCorners(c: [Point, Point, Point, Point]) {
	const xs = c.map((p) => p.x);
	const ys = c.map((p) => p.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return {
		x: Math.round(x),
		y: Math.round(y),
		width: Math.round(Math.max(...xs) - x),
		height: Math.round(Math.max(...ys) - y)
	};
}

function centeredFallback(W: number, H: number): CardDetection {
	const photoAspect = H / W;
	let width: number;
	let height: number;
	if (photoAspect > CARD_ASPECT) {
		width = Math.round(W * 0.85);
		height = Math.round(width * CARD_ASPECT);
	} else {
		height = Math.round(H * 0.85);
		width = Math.round(height / CARD_ASPECT);
	}
	return {
		corners: null,
		boundingRect: {
			x: Math.round((W - width) / 2),
			y: Math.round((H - height) / 2),
			width,
			height
		},
		homography: null,
		pxPerMm: null,
		aspectRatio: null,
		method: 'centered_fallback'
	};
}

/**
 * @deprecated Transition shim. Calls detectCard() and returns the
 * legacy CardRect shape. Existing call sites in recognition.ts and the
 * bench page continue to compile. New code should call detectCard()
 * directly.
 */
export async function detectCardRect(bitmap: ImageBitmap): Promise<CardRect> {
	const d = await detectCard(bitmap);
	return {
		x: d.boundingRect.x,
		y: d.boundingRect.y,
		width: d.boundingRect.width,
		height: d.boundingRect.height,
		method: d.method === 'corner_detected' ? 'corner_detected' : 'centered_fallback'
	};
}
