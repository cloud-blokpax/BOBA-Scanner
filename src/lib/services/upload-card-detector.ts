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
import type {
	ContourDiagnostic,
	ContourTelemetry,
	DetectionPassDiagnostic
} from './tier1-telemetry.types';

export type { ContourDiagnostic, ContourTelemetry, DetectionPassDiagnostic };

export interface Point {
	x: number;
	y: number;
}

/** Per-pass cap on contour_diagnostics list (sorted by area desc).
 *  Sized so a degenerate frame with 200 noise contours can't blow the
 *  scan_tier_results.extras 32KB cap. */
const CONTOUR_DIAG_CAP = 10;
/** Rectangularity floor used for the informational `passed_rectangularity`
 *  flag on each contour diagnostic. Not currently gated in code — see
 *  CLAUDE.md "Recognition Pipeline" → Detection. */
const RECTANGULARITY_FLOOR = 0.85;

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

	/** Per-detection auxiliary data. Currently carries `contour_diagnostics`. */
	extras?: Record<string, unknown>;
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

// Mode-specific aspect tolerances. Tighter than the legacy 1.28–1.55 window
// so the inner artwork frame (roughly square, aspect ~1.15–1.25) and
// off-card rectangles like book spines (aspect >1.55) are rejected by the
// gate. Live is permissive because handheld tilt skews the detected aspect;
// canonical is strictest because the user has deliberately framed the card.
// Tightened 2026-05-18: the previous loose [1.30, 1.50] window admitted
// inner artwork frames (often 1.45+) and noise blobs (often 1.30-1.34)
// on holo cards. Standard TCG aspect is 88/63 ≈ 1.397; keeping ±0.04
// rejects most non-card quads while still tolerating perspective skew.
const ASPECT_TOLERANCE_LIVE = { min: 1.36, max: 1.45 };
const ASPECT_TOLERANCE_CANONICAL = { min: 1.34, max: 1.46 };
const ASPECT_TOLERANCE_UPLOAD = { min: 1.32, max: 1.48 };

// Holo speculars saturate the V channel and create false edges inside the
// card that fragment the outer contour. Clamping V to this ceiling before
// Canny heals that without darkening normal cards.
const HSV_V_CLAMP = 240;

// Larger close-kernel bridges the broken-edge gaps holo rainbow noise leaves
// in the outer card contour, letting findContours close it into a single
// 4-vertex polygon. Costs ~2ms per frame at 600×800.
const DILATE_KERNEL_SIZE = 7;

export interface DetectCardOptions {
	mode?: 'live' | 'canonical' | 'upload';
}

function getAspectTolerance(mode: DetectCardOptions['mode']): { min: number; max: number } {
	if (mode === 'canonical') return ASPECT_TOLERANCE_CANONICAL;
	if (mode === 'upload') return ASPECT_TOLERANCE_UPLOAD;
	return ASPECT_TOLERANCE_LIVE;
}

/**
 * Clamp the HSV V channel so holo speculars (typically 250–255) flatten to
 * HSV_V_CLAMP before Canny. This removes the false edges that fragment the
 * outer card contour into multiple short segments on foil/rainbow cards.
 *
 * Caller owns the returned Mat and must `.delete()` it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clampSpeculars(src: any, cv: any): any {
	const hsv = new cv.Mat();
	const channels = new cv.MatVector();
	const clamped = new cv.Mat();

	try {
		cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
		cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
		cv.split(hsv, channels);

		const v = channels.get(2);
		cv.threshold(v, v, HSV_V_CLAMP, HSV_V_CLAMP, cv.THRESH_TRUNC);
		channels.set(2, v);

		cv.merge(channels, hsv);
		cv.cvtColor(hsv, clamped, cv.COLOR_HSV2RGB);
		cv.cvtColor(clamped, clamped, cv.COLOR_RGB2RGBA);

		return clamped;
	} finally {
		hsv.delete();
		channels.delete();
	}
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
	let src: any, clamped: any, gray: any, blurred: any, edges: any, kernel: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let contours: any, hierarchy: any;

	try {
		src = cv.matFromImageData(imageData);

		// Holo specular suppression — clamps overbright pixels in HSV V
		// channel so the rainbow noise on foil/holo cards stops fragmenting
		// the outer card edge into short segments.
		clamped = clampSpeculars(src, cv);

		gray = new cv.Mat();
		cv.cvtColor(clamped, gray, cv.COLOR_RGBA2GRAY);

		blurred = new cv.Mat();
		cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

		// Doc 1.2 — Layered detection. Try cheapest/sharpest method first;
		// fall back to softer methods if no 4-corner contour emerges.
		// Each layer fully resets edges/contours/hierarchy and reuses the
		// outer-scope Mats so the finally{} cleanup still works.

		edges = new cv.Mat();
		// Ellipse + 7×7 bridges holo-disrupted outer-edge gaps that the
		// legacy 3×3 rect kernel left as separate contours; the inner
		// artwork frame is filtered out by aspect ratio, not by kernel size.
		kernel = cv.getStructuringElement(
			cv.MORPH_ELLIPSE,
			new cv.Size(DILATE_KERNEL_SIZE, DILATE_KERNEL_SIZE)
		);
		contours = new cv.MatVector();
		hierarchy = new cv.Mat();

		const minArea = dw * dh * MIN_AREA_FRAC;
		const borderInsetPx = Math.max(2, Math.round(Math.min(dw, dh) * 0.005));
		const aspectTolerance = getAspectTolerance(options.mode);

		let bestCorners: [Point, Point, Point, Point] | null = null;
		let detectionLayer: string | null = null;

		// Per-pass diagnostics accumulator. Each call to findBestCorners
		// populates the `currentPassDiag` entry passed in by the caller; the
		// outer detectCard loop then appends it to the per-detection
		// `passes` list. Sorted+capped at CONTOUR_DIAG_CAP at append-time.
		const passes: DetectionPassDiagnostic[] = [];
		const aggregateRejections = {
			below_min_area: 0,
			touches_border_inset: 0,
			no_quad_at_any_eps: 0,
			aspect_out_of_range: 0
		};

		// Helper: from a populated `edges` Mat, find the best 4-corner card
		// contour. Mutates `contours` and `hierarchy` (zero'd at start of
		// each call to avoid stale data from previous attempts).
		//
		// Also writes per-contour forensics into `passDiag.contour_diagnostics`
		// (capped + sorted by the caller) and increments per-stage rejection
		// counters on `passDiag` so the analyst can see which gate dropped what.
		const findBestCorners = (
			passDiag: DetectionPassDiagnostic
		): [Point, Point, Point, Point] | null => {
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
			passDiag.contours_total = n;

			for (let i = 0; i < n; i++) {
				const c = contours.get(i);
				const area = cv.contourArea(c);
				if (area < minArea) {
					aggregateRejections.below_min_area++;
					c.delete();
					continue;
				}
				passDiag.contours_passed_area++;

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
					aggregateRejections.touches_border_inset++;
					c.delete();
					continue;
				}
				passDiag.contours_passed_border_inset++;

				const peri = cv.arcLength(c, true);
				const epsilonFactors = [0.02, 0.03, 0.04, 0.05];
				const vertexCountsPerEps: Record<string, number> = {};
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				let approx: any = null;
				// approxPolyDP loop is now diagnostic-only: it captures the
				// vertex-count distribution per contour into
				// `approx_vertex_counts_per_eps` (the field that surfaced the
				// 8-vertex bug post-hoc on BoBA cards with rounded corners).
				// Corner selection itself uses minAreaRect below, which works
				// regardless of vertex count.
				let found4 = false;
				for (const epsilonFactor of epsilonFactors) {
					if (approx) approx.delete();
					approx = new cv.Mat();
					cv.approxPolyDP(c, approx, epsilonFactor * peri, true);
					vertexCountsPerEps[epsilonFactor.toFixed(2)] = approx.rows;
					if (approx.rows === 4 && !found4) {
						found4 = true;
					}
				}

				// Per-contour forensic snapshot. Computed for every area- and
				// border-inset-passing contour, regardless of whether it wins.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				let hull: any = null;
				let hullArea = 0;
				let minAreaRectAspect = 0;
				let minAreaRectAngle = 0;
				let minAreaRectSize: [number, number] = [0, 0];
				try {
					hull = new cv.Mat();
					cv.convexHull(c, hull, false, true);
					hullArea = cv.contourArea(hull);
					const rr = cv.minAreaRect(c);
					const rrW = rr.size.width || 0;
					const rrH = rr.size.height || 0;
					minAreaRectSize = [Math.round(rrW), Math.round(rrH)];
					minAreaRectAngle = rr.angle ?? 0;
					const long = Math.max(rrW, rrH);
					const short = Math.min(rrW, rrH);
					minAreaRectAspect = short > 0 ? long / short : 0;
				} catch {
					// Best-effort forensics. Failure here must not break the
					// detector — the diagnostic just lands with zeros.
				} finally {
					try { hull?.delete(); } catch { /* ignore */ }
				}

				const rrFootprint = minAreaRectSize[0] * minAreaRectSize[1];
				const rectangularity = rrFootprint > 0 ? area / rrFootprint : 0;
				const aspectPassedFlag =
					minAreaRectAspect >= aspectTolerance.min &&
					minAreaRectAspect <= aspectTolerance.max;

				const contourDiag: ContourDiagnostic = {
					contour_area_downscaled: Math.round(area),
					bounding_rect: { x: br.x, y: br.y, w: br.width, h: br.height },
					approx_vertex_counts_per_eps: vertexCountsPerEps,
					min_area_rect_aspect: round3(minAreaRectAspect),
					min_area_rect_angle: round3(minAreaRectAngle),
					min_area_rect_size: minAreaRectSize,
					convex_hull_area: Math.round(hullArea),
					rectangularity: round3(rectangularity),
					perimeter: round3(peri),
					passed_aspect: aspectPassedFlag,
					passed_rectangularity: rectangularity >= RECTANGULARITY_FLOOR,
					final_picked: false
				};
				passDiag.contour_diagnostics.push(contourDiag);

				if (!found4) {
					aggregateRejections.no_quad_at_any_eps++;
				}

				// Use minAreaRect output (already computed for diagnostics above)
				// for actual corner selection. Works regardless of approxPolyDP
				// vertex count. On BoBA cards with rounded corners, approxPolyDP
				// returns 8 vertices, not 4, which used to silently discard the
				// correct contour. minAreaRect fits a rotated rectangle to any
				// contour and gives card-perfect output (verified offline on
				// Cupid/RBF-84 and Alien/OBF-98).
				if (
					minAreaRectAspect >= aspectTolerance.min &&
					minAreaRectAspect <= aspectTolerance.max &&
					rectangularity >= RECTANGULARITY_FLOOR &&
					rrFootprint > bestArea
				) {
					const rr = cv.minAreaRect(c);
					let raw: Point[] | null = null;
					if (typeof cv.boxPoints === 'function') {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const boxMat: any = new cv.Mat();
						try {
							cv.boxPoints(rr, boxMat);
							const pts: Point[] = [];
							for (let j = 0; j < 4; j++) {
								pts.push({
									x: boxMat.data32F[j * 2] / scale,
									y: boxMat.data32F[j * 2 + 1] / scale
								});
							}
							raw = pts;
						} finally {
							boxMat.delete();
						}
					} else {
						// Math fallback when cv.boxPoints isn't exposed by this
						// opencv-js build. Portable, no Mat lifetime concerns.
						raw = rectCorners(rr).map((p) => ({
							x: p.x / scale,
							y: p.y / scale
						}));
					}
					if (raw) {
						bestArea = rrFootprint;
						best = orderCorners(raw);
						contourDiag.final_picked = true;
					}
				} else if (
					minAreaRectAspect > 0 &&
					(minAreaRectAspect < aspectTolerance.min ||
						minAreaRectAspect > aspectTolerance.max)
				) {
					aggregateRejections.aspect_out_of_range++;
				}

				if (approx) approx.delete();
				c.delete();
			}
			return best;
		};

		// Compute edge density (fraction of edge pixels post-morph) for the
		// current `edges` Mat. Used per-pass to surface "low-edge frame"
		// detection failures separately from "lots-of-edges but no card".
		const measureEdgesPct = (): number => {
			try {
				const nz = cv.countNonZero(edges);
				const tot = edges.rows * edges.cols;
				return tot > 0 ? round3(nz / tot) : 0;
			} catch {
				return 0;
			}
		};

		// Layer 1 — Multi-scale Canny. Try sharpest threshold first; fall back
		// to softer thresholds if no valid quad emerges. Earlier code tried to
		// pick the globally-largest quad across all passes — that backfired by
		// letting softer-Canny noise blobs win on area. With minAreaRect-based
		// selection plus the rectangularity floor, the first pass that returns
		// a valid candidate IS the right answer.
		const cannyThresholds: Array<[number, number]> = [
			[75, 200],   // sharp — high precision
			[40, 120],   // softer — catches dim edges from glare
			[20, 80]     // softest — last resort
		];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let cannyOut: any = null;
		try {
			for (const [lo, hi] of cannyThresholds) {
				if (cannyOut) cannyOut.delete();
				cannyOut = new cv.Mat();
				cv.Canny(blurred, cannyOut, lo, hi);
				if (edges.rows === 0) {
					cannyOut.copyTo(edges);
				} else {
					cv.bitwise_or(edges, cannyOut, edges);
				}
				cv.dilate(edges, edges, kernel);
				cv.erode(edges, edges, kernel);
				const layerName = `canny_${lo}_${hi}`;
				const passDiag: DetectionPassDiagnostic = {
					layer: layerName,
					edges_after_morph_pct: measureEdgesPct(),
					contours_total: 0,
					contours_passed_area: 0,
					contours_passed_border_inset: 0,
					contour_diagnostics: []
				};
				const corners = findBestCorners(passDiag);
				passes.push(passDiag);
				if (corners) {
					bestCorners = corners;
					detectionLayer = layerName;
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
				const adaptivePassDiag: DetectionPassDiagnostic = {
					layer: 'adaptive',
					edges_after_morph_pct: measureEdgesPct(),
					contours_total: 0,
					contours_passed_area: 0,
					contours_passed_border_inset: 0,
					contour_diagnostics: []
				};
				bestCorners = findBestCorners(adaptivePassDiag);
				passes.push(adaptivePassDiag);
				if (bestCorners) detectionLayer = 'adaptive';
			} finally {
				if (adaptive) adaptive.delete();
				if (largeKernel) largeKernel.delete();
			}
		}

		// Trim each pass's contour_diagnostics to the cap (sorted by area desc)
		// and mark the globally-picked contour as final_picked = true. This
		// runs even when bestCorners is null, so the analyst still gets the
		// per-pass forensics on detector misses.
		const contourTelemetry = finalizeContourTelemetry(
			passes,
			detectionLayer,
			bestCorners,
			dw,
			dh,
			scale,
			aggregateRejections
		);

		if (!bestCorners) {
			const fallback = centeredFallback(W, H);
			return {
				...fallback,
				extras: { contour_diagnostics: contourTelemetry }
			};
		}

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
			detection_layer: detectionLayer,
			extras: {
				contour_diagnostics: contourTelemetry
			}
		};
	} catch (err) {
		console.debug('[card-detector] threw, using fallback:', err);
		return centeredFallback(W, H);
	} finally {
		try { src?.delete(); } catch { /* ignore */ }
		try { clamped?.delete(); } catch { /* ignore */ }
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

/**
 * Compute the 4 corners of an OpenCV RotatedRect from its center/size/angle.
 * Used as a portable fallback when `cv.boxPoints` is not exposed by the
 * bundled opencv-js build. Output order matches `cv.boxPoints`: the
 * downstream `orderCorners` re-sorts to TL/TR/BR/BL regardless.
 */
function rectCorners(rr: {
	center: { x: number; y: number };
	size: { width: number; height: number };
	angle: number;
}): Point[] {
	const a = (rr.angle * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	const hw = rr.size.width / 2;
	const hh = rr.size.height / 2;
	return [
		{ x: rr.center.x + -hw * c - -hh * s, y: rr.center.y + -hw * s + -hh * c },
		{ x: rr.center.x + hw * c - -hh * s, y: rr.center.y + hw * s + -hh * c },
		{ x: rr.center.x + hw * c - hh * s, y: rr.center.y + hw * s + hh * c },
		{ x: rr.center.x + -hw * c - hh * s, y: rr.center.y + -hw * s + hh * c }
	];
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

function round3(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.round(n * 1000) / 1000;
}

/**
 * Finalize per-pass contour diagnostics into a single ContourTelemetry blob.
 *   - Sort each pass's contours by area desc, trim to CONTOUR_DIAG_CAP.
 *   - Mark the contour matching the global winner as final_picked = true.
 *     Match is by per-pass bounding-rect equality (the only stable handle we
 *     have once Mats are deleted); for canny passes the winning corners come
 *     from the same pass and the bounding rect derived from the contour is
 *     identical to the one stored in the diagnostic. The adaptive pass
 *     follows the same logic.
 *   - Compute the picked-summary fields (layer, aspect, rectangularity,
 *     area as fraction of bitmap).
 */
function finalizeContourTelemetry(
	passes: DetectionPassDiagnostic[],
	pickedLayer: string | null,
	bestCorners: [Point, Point, Point, Point] | null,
	dw: number,
	dh: number,
	scale: number,
	rejections: ContourTelemetry['rejection_reasons']
): ContourTelemetry {
	// Trim each pass's contour list, sorted by area desc, to the cap.
	for (const p of passes) {
		p.contour_diagnostics.sort(
			(a, b) => b.contour_area_downscaled - a.contour_area_downscaled
		);
		if (p.contour_diagnostics.length > CONTOUR_DIAG_CAP) {
			p.contour_diagnostics.length = CONTOUR_DIAG_CAP;
		}
	}

	// Locate the picked contour. The picked layer's diagnostics list is the
	// only place to look — bestCorners came from that pass. Match by
	// approximate bounding-rect overlap to the winner's bbox.
	let pickedAspect: number | null = null;
	let pickedRect: number | null = null;
	let pickedAreaPctOfBitmap: number | null = null;
	if (bestCorners && pickedLayer) {
		// bestCorners are in source coords (already de-scaled). Translate back
		// to downsampled coords for comparison against the per-pass bbox,
		// which was recorded in downsampled space.
		const xsDown = bestCorners.map((c) => c.x * scale);
		const ysDown = bestCorners.map((c) => c.y * scale);
		const wx = Math.min(...xsDown);
		const wy = Math.min(...ysDown);
		const ww = Math.max(...xsDown) - wx;
		const wh = Math.max(...ysDown) - wy;
		const winnerPass = passes.find((p) => p.layer === pickedLayer);
		if (winnerPass) {
			// Pick the contour whose downsampled bounding rect best overlaps
			// the winner. The picked contour came directly from the pass, so
			// IoU should be ~1.0 for the right one and <0.5 for everything
			// else. Linear scan over <= CONTOUR_DIAG_CAP entries is cheap.
			let bestIoU = 0;
			let bestEntry: ContourDiagnostic | null = null;
			for (const cd of winnerPass.contour_diagnostics) {
				const iou = bboxIoU(cd.bounding_rect, {
					x: wx,
					y: wy,
					w: ww,
					h: wh
				});
				if (iou > bestIoU) {
					bestIoU = iou;
					bestEntry = cd;
				}
			}
			if (bestEntry && bestIoU > 0.5) {
				bestEntry.final_picked = true;
				pickedAspect = bestEntry.min_area_rect_aspect;
				pickedRect = bestEntry.rectangularity;
				pickedAreaPctOfBitmap =
					dw * dh > 0
						? round3(bestEntry.contour_area_downscaled / (dw * dh))
						: null;
			}
		}
	}

	return {
		passes,
		picked_layer: pickedLayer,
		picked_aspect: pickedAspect,
		picked_rectangularity: pickedRect,
		picked_box_area_pct_of_bitmap: pickedAreaPctOfBitmap,
		rejection_reasons: rejections
	};
}

function bboxIoU(
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number }
): number {
	const ix1 = Math.max(a.x, b.x);
	const iy1 = Math.max(a.y, b.y);
	const ix2 = Math.min(a.x + a.w, b.x + b.w);
	const iy2 = Math.min(a.y + a.h, b.y + b.h);
	const iw = Math.max(0, ix2 - ix1);
	const ih = Math.max(0, iy2 - iy1);
	const inter = iw * ih;
	const union = a.w * a.h + b.w * b.h - inter;
	return union > 0 ? inter / union : 0;
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
