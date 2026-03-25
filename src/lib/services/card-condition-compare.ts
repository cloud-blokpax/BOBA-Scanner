/**
 * Card Condition Comparison Engine
 *
 * Pipeline:
 *   1. Detect card border via Canny + findContours + approxPolyDP
 *   2. Perspective-correct both cards to a standard rectangle
 *   3. Convert to LAB color space
 *   4. Compute per-pixel absolute difference on L channel (structural damage)
 *   5. Threshold + dilate to merge nearby defects
 *   6. Segment into regions (corners, edges, center) and count defect pixels per region
 *   7. Generate heat overlay as ImageData for display
 *
 * All OpenCV operations use cv.Mat objects which MUST be freed with .delete()
 * to prevent WASM memory leaks. Every Mat created is tracked and freed in a
 * finally block.
 */

import { loadOpenCV } from './opencv-loader';

export interface ComparisonResult {
	/** Heat overlay for Card A as a data URL (red = difference from B) */
	heatOverlayA: string;
	/** Heat overlay for Card B as a data URL (red = difference from A) */
	heatOverlayB: string;
	/** Aligned Card A as a data URL */
	alignedA: string;
	/** Aligned Card B as a data URL */
	alignedB: string;
	/** Per-region defect scores (0-100, higher = more defects detected) */
	regions: {
		topLeftCorner: { a: number; b: number };
		topRightCorner: { a: number; b: number };
		bottomLeftCorner: { a: number; b: number };
		bottomRightCorner: { a: number; b: number };
		topEdge: { a: number; b: number };
		bottomEdge: { a: number; b: number };
		leftEdge: { a: number; b: number };
		rightEdge: { a: number; b: number };
		center: { a: number; b: number };
	};
	/** Overall score — lower is better (fewer defects) */
	overallScoreA: number;
	overallScoreB: number;
	/** Which card appears to be in better condition */
	recommendation: 'A' | 'B' | 'similar';
	/** Centering ratios for each card (if border was detected) */
	centeringA: { lr: string; tb: string } | null;
	centeringB: { lr: string; tb: string } | null;
	/** Processing time in ms */
	processingMs: number;
}

// Standard output size for aligned cards (pixels)
const ALIGNED_WIDTH = 500;
const ALIGNED_HEIGHT = 700; // Standard card ratio ~2.5:3.5

/**
 * Compare two card images and return a detailed condition analysis.
 */
export async function compareCards(
	imageA: Blob | ImageBitmap,
	imageB: Blob | ImageBitmap
): Promise<ComparisonResult> {
	const startTime = performance.now();
	const cv = await loadOpenCV();

	// Track all Mats for cleanup
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const mats: any[] = [];
	const track = <T>(mat: T): T => {
		mats.push(mat);
		return mat;
	};

	try {
		// Load images into cv.Mat
		const matA = track(await blobToMat(cv, imageA));
		const matB = track(await blobToMat(cv, imageB));

		// Step 1-2: Detect card border and perspective-correct
		const alignedA = track(alignCard(cv, matA, track));
		const alignedB = track(alignCard(cv, matB, track));

		// Step 3: Convert to LAB color space
		const labA = track(new cv.Mat());
		const labB = track(new cv.Mat());
		cv.cvtColor(alignedA, labA, cv.COLOR_RGBA2RGB);
		const labA2 = track(new cv.Mat());
		cv.cvtColor(labA, labA2, cv.COLOR_RGB2Lab);
		cv.cvtColor(alignedB, labB, cv.COLOR_RGBA2RGB);
		const labB2 = track(new cv.Mat());
		cv.cvtColor(labB, labB2, cv.COLOR_RGB2Lab);

		// Step 4: Split L channel and compute absolute difference
		const channelsA = track(new cv.MatVector());
		const channelsB = track(new cv.MatVector());
		cv.split(labA2, channelsA);
		cv.split(labB2, channelsB);
		const lA = track(channelsA.get(0));
		const lB = track(channelsB.get(0));
		const diff = track(new cv.Mat());
		cv.absdiff(lA, lB, diff);

		// Step 5: Threshold to isolate significant differences
		const thresholded = track(new cv.Mat());
		cv.threshold(diff, thresholded, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);

		// Dilate to merge nearby defect pixels into coherent regions
		const kernel = track(
			cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
		);
		const dilated = track(new cv.Mat());
		cv.dilate(thresholded, dilated, kernel, new cv.Point(-1, -1), 2);

		// Step 6: Segment into regions and score
		const regions = scoreRegions(cv, dilated);

		// Step 7: Generate heat overlay using JET colormap
		const heatmap = track(new cv.Mat());
		cv.applyColorMap(diff, heatmap, cv.COLORMAP_JET);

		// Convert results to data URLs
		const heatOverlayA = matToDataUrl(cv, heatmap);
		const heatOverlayB = matToDataUrl(cv, heatmap);
		const alignedAUrl = matToDataUrl(cv, alignedA);
		const alignedBUrl = matToDataUrl(cv, alignedB);

		// Compute centering from the original (pre-alignment) card border detection
		const centeringA = measureCentering(cv, matA, track);
		const centeringB = measureCentering(cv, matB, track);

		// Calculate overall scores
		const overallScoreA =
			Object.values(regions).reduce((sum, r) => sum + r.a, 0) /
			Object.keys(regions).length;
		const overallScoreB =
			Object.values(regions).reduce((sum, r) => sum + r.b, 0) /
			Object.keys(regions).length;

		const recommendation =
			Math.abs(overallScoreA - overallScoreB) < 5
				? ('similar' as const)
				: overallScoreA < overallScoreB
					? ('A' as const)
					: ('B' as const);

		return {
			heatOverlayA,
			heatOverlayB,
			alignedA: alignedAUrl,
			alignedB: alignedBUrl,
			regions,
			overallScoreA: Math.round(overallScoreA),
			overallScoreB: Math.round(overallScoreB),
			recommendation,
			centeringA,
			centeringB,
			processingMs: Math.round(performance.now() - startTime)
		};
	} finally {
		// CRITICAL: Free all OpenCV Mats to prevent WASM memory leaks.
		for (const mat of mats) {
			try {
				if (mat && typeof mat.delete === 'function') mat.delete();
			} catch {
				/* already freed */
			}
		}
	}
}

/**
 * Convert a Blob or ImageBitmap to an OpenCV Mat.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function blobToMat(cv: any, source: Blob | ImageBitmap): Promise<any> {
	let bitmap: ImageBitmap;
	if (source instanceof Blob) {
		bitmap = await createImageBitmap(source);
	} else {
		bitmap = source;
	}

	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

	if (source instanceof Blob) bitmap.close();

	return cv.matFromImageData(imageData);
}

/**
 * Detect the card's rectangular border and perspective-correct to a standard size.
 * Falls back to center-crop if border detection fails.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function alignCard(cv: any, src: any, track: <T>(m: T) => T): any {
	const gray = track(new cv.Mat());
	cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

	const blurred = track(new cv.Mat());
	cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

	const edges = track(new cv.Mat());
	cv.Canny(blurred, edges, 50, 150);

	const contours = track(new cv.MatVector());
	const hierarchy = track(new cv.Mat());
	cv.findContours(
		edges,
		contours,
		hierarchy,
		cv.RETR_EXTERNAL,
		cv.CHAIN_APPROX_SIMPLE
	);

	// Find the largest 4-sided contour (the card)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let bestContour: any = null;
	let bestArea = 0;
	for (let i = 0; i < contours.size(); i++) {
		const contour = contours.get(i);
		const area = cv.contourArea(contour);
		if (area < src.rows * src.cols * 0.1) continue;

		const peri = cv.arcLength(contour, true);
		const approx = track(new cv.Mat());
		cv.approxPolyDP(contour, approx, 0.02 * peri, true);

		if (approx.rows === 4 && area > bestArea) {
			bestContour = approx;
			bestArea = area;
		}
	}

	// If no 4-sided contour found, fall back to resizing the entire image
	if (!bestContour) {
		const resized = new cv.Mat();
		cv.resize(src, resized, new cv.Size(ALIGNED_WIDTH, ALIGNED_HEIGHT));
		return resized;
	}

	// Extract corner points and sort them: TL, TR, BR, BL
	const points = [];
	for (let i = 0; i < 4; i++) {
		points.push({
			x: bestContour.data32S[i * 2],
			y: bestContour.data32S[i * 2 + 1]
		});
	}
	const sorted = sortCorners(points);

	const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
		sorted[0].x,
		sorted[0].y,
		sorted[1].x,
		sorted[1].y,
		sorted[2].x,
		sorted[2].y,
		sorted[3].x,
		sorted[3].y
	]);
	const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
		0,
		0,
		ALIGNED_WIDTH,
		0,
		ALIGNED_WIDTH,
		ALIGNED_HEIGHT,
		0,
		ALIGNED_HEIGHT
	]);
	track(srcPts);
	track(dstPts);

	const M = track(cv.getPerspectiveTransform(srcPts, dstPts));
	const warped = new cv.Mat();
	cv.warpPerspective(
		src,
		warped,
		M,
		new cv.Size(ALIGNED_WIDTH, ALIGNED_HEIGHT)
	);
	return warped;
}

/**
 * Sort 4 corner points into [TL, TR, BR, BL] order.
 */
function sortCorners(
	pts: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
	const sorted = [...pts];
	sorted.sort((a, b) => a.x + a.y - (b.x + b.y));
	const tl = sorted[0];
	const br = sorted[3];
	const remaining = [sorted[1], sorted[2]];
	remaining.sort((a, b) => a.y - a.x - (b.y - b.x));
	const tr = remaining[0];
	const bl = remaining[1];
	return [tl, tr, br, bl];
}

/**
 * Score defect density in each card region.
 * Returns 0-100 per region (percentage of defect pixels).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoreRegions(cv: any, diffMat: any): ComparisonResult['regions'] {
	const h = diffMat.rows;
	const w = diffMat.cols;
	const cornerSize = Math.round(Math.min(w, h) * 0.12);
	const edgeWidth = Math.round(Math.min(w, h) * 0.06);

	function regionScore(x: number, y: number, rw: number, rh: number): number {
		const roi = diffMat.roi(new cv.Rect(x, y, rw, rh));
		const nonZero = cv.countNonZero(roi);
		const total = rw * rh;
		roi.delete();
		return Math.round((nonZero / total) * 100);
	}

	const score = (x: number, y: number, rw: number, rh: number) => {
		const s = regionScore(x, y, rw, rh);
		return { a: s, b: s };
	};

	return {
		topLeftCorner: score(0, 0, cornerSize, cornerSize),
		topRightCorner: score(w - cornerSize, 0, cornerSize, cornerSize),
		bottomLeftCorner: score(0, h - cornerSize, cornerSize, cornerSize),
		bottomRightCorner: score(
			w - cornerSize,
			h - cornerSize,
			cornerSize,
			cornerSize
		),
		topEdge: score(cornerSize, 0, w - 2 * cornerSize, edgeWidth),
		bottomEdge: score(cornerSize, h - edgeWidth, w - 2 * cornerSize, edgeWidth),
		leftEdge: score(0, cornerSize, edgeWidth, h - 2 * cornerSize),
		rightEdge: score(w - edgeWidth, cornerSize, edgeWidth, h - 2 * cornerSize),
		center: score(
			Math.round(w * 0.2),
			Math.round(h * 0.2),
			Math.round(w * 0.6),
			Math.round(h * 0.6)
		)
	};
}

/**
 * Measure card centering from detected border.
 * Returns L/R and T/B ratios as strings like "52/48".
 */
function measureCentering(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	cv: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	src: any,
	track: <T>(m: T) => T
): { lr: string; tb: string } | null {
	const gray = track(new cv.Mat());
	cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
	const blurred = track(new cv.Mat());
	cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
	const edges = track(new cv.Mat());
	cv.Canny(blurred, edges, 50, 150);
	const contours = track(new cv.MatVector());
	const hierarchy = track(new cv.Mat());
	cv.findContours(
		edges,
		contours,
		hierarchy,
		cv.RETR_EXTERNAL,
		cv.CHAIN_APPROX_SIMPLE
	);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let bestContour: any = null;
	let bestArea = 0;
	for (let i = 0; i < contours.size(); i++) {
		const contour = contours.get(i);
		const area = cv.contourArea(contour);
		if (area < src.rows * src.cols * 0.1) continue;
		const peri = cv.arcLength(contour, true);
		const approx = track(new cv.Mat());
		cv.approxPolyDP(contour, approx, 0.02 * peri, true);
		if (approx.rows === 4 && area > bestArea) {
			bestContour = approx;
			bestArea = area;
		}
	}

	if (!bestContour) return null;

	const pts = [];
	for (let i = 0; i < 4; i++) {
		pts.push({
			x: bestContour.data32S[i * 2],
			y: bestContour.data32S[i * 2 + 1]
		});
	}
	const sorted = sortCorners(pts);

	const leftBorder = sorted[0].x;
	const rightBorder = src.cols - sorted[1].x;
	const topBorder = sorted[0].y;
	const bottomBorder = src.rows - sorted[3].y;

	const lrTotal = leftBorder + rightBorder;
	const tbTotal = topBorder + bottomBorder;

	if (lrTotal < 10 || tbTotal < 10) return null;

	const lrLeft = Math.round((leftBorder / lrTotal) * 100);
	const lrRight = 100 - lrLeft;
	const tbTop = Math.round((topBorder / tbTotal) * 100);
	const tbBottom = 100 - tbTop;

	return {
		lr: `${lrLeft}/${lrRight}`,
		tb: `${tbTop}/${tbBottom}`
	};
}

/**
 * Convert a cv.Mat to a data URL string for display.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matToDataUrl(cv: any, mat: any): string {
	const canvas = new OffscreenCanvas(mat.cols, mat.rows);
	const ctx = canvas.getContext('2d')!;

	// Convert to RGBA if needed
	let rgba = mat;
	let needsDelete = false;
	if (mat.channels() === 3) {
		rgba = new cv.Mat();
		cv.cvtColor(mat, rgba, cv.COLOR_BGR2RGBA);
		needsDelete = true;
	} else if (mat.channels() === 1) {
		rgba = new cv.Mat();
		cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
		needsDelete = true;
	}

	const imageData = new ImageData(
		new Uint8ClampedArray(rgba.data),
		rgba.cols,
		rgba.rows
	);
	ctx.putImageData(imageData, 0, 0);

	if (needsDelete) rgba.delete();

	const regularCanvas = document.createElement('canvas');
	regularCanvas.width = mat.cols;
	regularCanvas.height = mat.rows;
	const regularCtx = regularCanvas.getContext('2d')!;
	regularCtx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
	return regularCanvas.toDataURL('image/jpeg', 0.85);
}
