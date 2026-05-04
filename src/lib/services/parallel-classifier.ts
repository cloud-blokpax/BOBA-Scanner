/**
 * Rule-based Wonders parallel classifier.
 *
 * Rules, in order (positive-signal text matches first, pixel heuristics
 * as a fallback):
 *   1. OCM: left-edge fractional serial in any print run (/10, /50, /99, /250…)
 *   2. Stonefoil / 1-of-1: left-edge "ONE OF ONE" text (OCR drops middle "OF"
 *      on gold-on-black kerning; regex accepts "ONEONE" too)
 *   3. FF: no border (edge-density on perimeter ~ edge-density on center).
 *      Fallback only — holographic OCM foils suppress perimeter contrast and
 *      would be mis-labeled FF if this ran before the OCM serial check.
 *   4. CF: diagonal hatching in border (FFT — stubbed, 2.1a.1 follow-up)
 *   5. Default: paper
 *
 * IMPORTANT: This classifier outputs SHORT CODES ('cf', 'ff', 'ocm', 'sf',
 * 'paper'). Short codes are internal-only. Every DB write path must map
 * the code to a human-readable name (via `WONDERS_PARALLEL_NAMES` re-
 * exported below, or `toParallelName()` from `$lib/data/wonders-parallels`)
 * before persisting.
 */

import { ocrFullFrame, boxCenterNormalized, type OCRBox } from './paddle-ocr';
import type { WondersParallelCode, WondersParallelName } from '$lib/data/wonders-parallels';
import { WONDERS_PARALLEL_CODE_TO_NAME } from '$lib/data/wonders-parallels';

export type WondersParallel = WondersParallelCode | 'unknown';

/**
 * Short-code → human-readable DB name. Re-exported here (backed by the
 * canonical table in `$lib/data/wonders-parallels`) so any caller reaching
 * for a mapping at the classifier boundary doesn't have to import from two
 * places. `unknown` folds to 'Paper' — safe default, never persist 'unknown'.
 */
export const WONDERS_PARALLEL_NAMES: Record<WondersParallel, WondersParallelName> = {
	...WONDERS_PARALLEL_CODE_TO_NAME,
	unknown: 'Paper'
};

export interface ParallelResult {
	parallel: WondersParallel;
	ruleFired:
		| 'ff_no_border'
		| 'ff_first_edition_stamp'
		| 'ocm_serial_detected'
		| 'sf_one_of_one'
		| 'cf_diagonal'
		| 'default_paper'
		| 'uncertain';
	confidence: number;
	evidence: Record<string, number | string | boolean | object>;
}

/**
 * Position-based OCM serial detection.
 *
 * OCM (Orbital Color Match) cards have a print-run serial (e.g. "66/99",
 * "12/50", "3/10", "247/250") rendered vertically on the LEFT EDGE of the
 * card, in the upper-to-middle Y range. The serial uses any print-run
 * denominator the publisher chooses — known forms include /10, /50, /75,
 * /99, /250 and there is no exhaustive list, so we accept any
 * \d{1,4}/\d{1,4} pattern with sane numerator/denominator semantics
 * (numerator >= 1, denominator >= 1, numerator <= denominator).
 *
 * Wonders card NUMBERS are also fractional ("316/401", "1/402" — 408 rows
 * in the catalog use this form). The disambiguator is position: card
 * numbers print horizontally at the bottom of the card; OCM serials print
 * vertically on the left edge. We require the box centroid to satisfy
 * x < OCM_LEFT_EDGE_MAX and y < OCM_BOTTOM_EXCLUSION_MIN before accepting
 * the box as a serial candidate.
 *
 * Returns the canonical "N/D" form when a left-edge serial is found, null
 * otherwise.
 */
const OCM_LEFT_EDGE_MAX = 0.15; // box centroid x < 15% of card width
const OCM_BOTTOM_EXCLUSION_MIN = 0.85; // and y < 85% of card height (excludes bottom card_number)
const OCM_FRACTION_RE = /\b(\d{1,4})\s*\/\s*(\d{1,4})\b/;

export function matchOCMSerial(
	boxes: OCRBox[],
	bitmapW: number,
	bitmapH: number
): string | null {
	for (const b of boxes) {
		if (!b.text) continue;
		const center = boxCenterNormalized(b.box, bitmapW, bitmapH);
		if (!center) continue;
		if (center.x >= OCM_LEFT_EDGE_MAX) continue;
		if (center.y >= OCM_BOTTOM_EXCLUSION_MIN) continue;

		const m = b.text.toUpperCase().match(OCM_FRACTION_RE);
		if (!m) continue;
		const num = parseInt(m[1], 10);
		const den = parseInt(m[2], 10);
		if (!Number.isFinite(num) || !Number.isFinite(den)) continue;
		if (num < 1 || den < 1) continue;
		if (num > den) continue; // "63 of 99" yes, "401 of 316" no — that's a card_number
		return `${num}/${den}`;
	}
	return null;
}

/**
 * Position-based Stonefoil "ONE OF ONE" detection.
 *
 * Stonefoil cards have "ONE OF ONE" rendered in gold-on-black on the left
 * edge. PaddleOCR consistently drops the middle "OF" against the kerned
 * gold typeface, so we accept "ONEONE" as well as "ONE OF ONE". Same
 * left-edge position filter as OCM — the gold-on-black text doesn't print
 * elsewhere on the card.
 */
const SF_LEFT_EDGE_MAX = 0.15;

export function matchOneOfOne(
	boxes: OCRBox[],
	bitmapW: number,
	bitmapH: number
): boolean {
	for (const b of boxes) {
		if (!b.text) continue;
		const center = boxCenterNormalized(b.box, bitmapW, bitmapH);
		if (!center) continue;
		if (center.x >= SF_LEFT_EDGE_MAX) continue;

		const upper = b.text.toUpperCase();
		const noSpace = upper.replace(/\s+/g, '');
		if (/ONE\s*(?:OF\s*)?ONE/.test(upper) || /ONEONE/.test(noSpace)) {
			return true;
		}
	}
	return false;
}

/**
 * Phase 1 Doc 1.2 — detect the 1st-edition stamp at the bottom-left of
 * Wonders FF/OCM/SF cards. The stamp is a hexagon outline with a "1"
 * inside, sitting immediately left of the collector number.
 *
 * Two signals:
 *  A) OCR a small ROI; look for a single-character "1" or "I" box.
 *  B) Edge-detect the same ROI; look for a closed 6-sided contour.
 *
 * Either signal is sufficient — both raises confidence.
 *
 * Coordinates assume the input bitmap is the canonical 750×1050 crop
 * from cropToCanonical (corner-detected). For non-canonical inputs the
 * ROI fallback uses 0.03–0.15 (X) × 0.92–0.98 (Y) of bitmap dimensions.
 */
async function detectFirstEditionStamp(bitmap: ImageBitmap): Promise<{
	detected: boolean;
	confidence: number;
	signals: { ocr: boolean; hexContour: boolean };
}> {
	const W = bitmap.width;
	const H = bitmap.height;
	// Crop ROI: bottom-left, just left of where the collector number sits.
	// Numbers from inspection of canonical 750×1050 crops:
	//   stamp center is at ~5% X, ~95% Y, ~4% wide × 3% tall.
	// Pad the crop generously to absorb misalignment.
	const roiX = Math.floor(W * 0.02);
	const roiY = Math.floor(H * 0.91);
	const roiW = Math.floor(W * 0.13);
	const roiH = Math.floor(H * 0.08);

	const canvas = new OffscreenCanvas(roiW, roiH);
	const ctx = canvas.getContext('2d');
	if (!ctx) return { detected: false, confidence: 0, signals: { ocr: false, hexContour: false } };
	ctx.drawImage(bitmap, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
	const roiBitmap = await createImageBitmap(canvas);

	// Signal A — OCR for "1" or "I"
	let ocrFound = false;
	try {
		const ocr = await ocrFullFrame(roiBitmap, { maxLongEdge: 256 });
		// Hexagon-with-1 reads as "1", "(1)", "[1]", "I", or sometimes "0"
		// when the hex border bleeds into the digit. Accept any one of these
		// when the box covers <50% of the ROI width (excludes "316/401" runs).
		for (const box of ocr.boxes) {
			const text = box.text.replace(/[^\dI]/g, '').trim();
			if (text === '1' || text === 'I') {
				// box is a 4-point polygon; compute width as max-x minus min-x
				let minX = Infinity;
				let maxX = -Infinity;
				if (Array.isArray(box.box)) {
					for (const p of box.box) {
						if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0])) {
							if (p[0] < minX) minX = p[0];
							if (p[0] > maxX) maxX = p[0];
						}
					}
				}
				const boxWidth = Number.isFinite(minX) && Number.isFinite(maxX) ? maxX - minX : 0;
				if (boxWidth > 0 && boxWidth < roiW * 0.5) {
					ocrFound = true;
					break;
				}
			}
		}
	} catch (err) {
		console.debug('[parallel-classifier] stamp OCR failed:', err);
	}

	// Signal B — hex contour
	let hexFound = false;
	try {
		hexFound = await detectHexContour(roiBitmap);
	} catch (err) {
		console.debug('[parallel-classifier] hex contour failed:', err);
	}

	roiBitmap.close();

	const detected = ocrFound || hexFound;
	const confidence = ocrFound && hexFound ? 0.95 : detected ? 0.75 : 0;
	return { detected, confidence, signals: { ocr: ocrFound, hexContour: hexFound } };
}

/**
 * Detect a closed 6-vertex contour in the ROI using OpenCV.js or a
 * lightweight pure-JS edge+approxPoly fallback. Implementation note:
 * opencv.js is not currently imported in this file. Until it is, this
 * function returns false and the OCR signal alone carries stamp
 * detection — that catches ~90% of stamps based on inspection of 12
 * cards per Phase 1 Doc 1.2.
 */
async function detectHexContour(_roiBitmap: ImageBitmap): Promise<boolean> {
	// IMPLEMENTER: when opencv.js is wired into this file, use
	// cv.findContours + cv.approxPolyDP with epsilon = 0.04 * cv.arcLength.
	// Look for contours where approx.rows === 6 AND area > (W*H) * 0.01.
	return false;
}

export async function classifyWondersParallel(bitmap: ImageBitmap): Promise<ParallelResult> {
	const evidence: ParallelResult['evidence'] = {};

	// Run full-frame OCR FIRST. Powers the positive-signal text rules
	// (OCM serial + Stonefoil ONE-OF-ONE). Distinct print-run serials
	// (/10, /50, /75, /99, /250, ...) and "ONE OF ONE" gold-on-black
	// text are the most distinctive evidence Wonders parallels carry —
	// they should win before we fall back to pixel-level border heuristics.
	let fullFrameBoxes: OCRBox[] = [];
	try {
		const ocr = await ocrFullFrame(bitmap, { maxLongEdge: 1800 });
		fullFrameBoxes = ocr.boxes;
		evidence.full_frame_ocr_box_count = ocr.boxes.length;
	} catch (err) {
		evidence.full_frame_ocr_error = String(err);
	}

	// Rule 1 (was Rule 2): OCM — left-edge fractional serial in any print run.
	const ocmSerial = matchOCMSerial(fullFrameBoxes, bitmap.width, bitmap.height);
	if (ocmSerial) {
		evidence.ocm_serial = ocmSerial;
		return {
			parallel: 'ocm',
			ruleFired: 'ocm_serial_detected',
			confidence: 0.95,
			evidence
		};
	}

	// Rule 2 (was Rule 3): Stonefoil — "ONE OF ONE" / "ONEONE" left-edge text.
	if (matchOneOfOne(fullFrameBoxes, bitmap.width, bitmap.height)) {
		evidence.one_of_one_detected = true;
		return {
			parallel: 'sf',
			ruleFired: 'sf_one_of_one',
			confidence: 0.95,
			evidence
		};
	}

	// Phase 1 Doc 1.2 — Rule 3 is now stamp detection.
	// FF/OCM/SF all carry a 1st-edition hexagon stamp at bottom-left.
	// OCM and SF were already matched above by their distinctive text
	// signals. If we reach here with a stamp present, the card must be FF.
	const stamp = await detectFirstEditionStamp(bitmap);
	evidence.first_edition_stamp = stamp;
	if (stamp.detected) {
		return {
			parallel: 'ff',
			ruleFired: 'ff_first_edition_stamp',
			confidence: stamp.confidence,
			evidence
		};
	}

	// Phase 1 Doc 1.2 — RULE REMOVED: ff_no_border (pixel-edge ratio).
	// The threshold at < 1.25 fired on every card type with confidence
	// ~1.0, breaking Tier 1 for 30+ days. The stamp detection above
	// replaces it with a positive signal.

	// Rule 4: CF diagonal hatching — stubbed (TODO future). CF will be
	// classified as Paper for now; the gate / Tier 2 will catch
	// misclassifications when card_number-based lookup disagrees.

	// Rule 5: default to paper. Confidence 0.7 — Paper is the dominant
	// parallel by volume, so the default is mostly right.
	return {
		parallel: 'paper',
		ruleFired: 'default_paper',
		confidence: 0.7,
		evidence
	};
}

/**
 * NOTE (Phase 1 Doc 1.2): No longer called from classifyWondersParallel.
 * The < 1.25 threshold mis-classified all parallels as FF. Kept available
 * for future re-tuning if combined with FFT-based hatching detection.
 *
 * Samples edge magnitude (Sobel) in a thin ring at the card perimeter vs the
 * center. Cards WITH a border (paper/CF/OCM) show high edge density on the
 * border strip because of the frame. FF cards (no border) have perimeter
 * density similar to the center.
 *
 * Returns ratio = edge_density(perimeter) / edge_density(center).
 * Higher ratio → card has a visible border.
 */
async function measureBorderVsCenterEdgeRatio(bitmap: ImageBitmap): Promise<number> {
	const W = 96;
	const H = 134; // downsample target for speed
	const canvas = new OffscreenCanvas(W, H);
	const ctx = canvas.getContext('2d');
	if (!ctx) return 999; // fail-open: assume bordered
	ctx.drawImage(bitmap, 0, 0, W, H);
	const img = ctx.getImageData(0, 0, W, H);

	const gray = new Float32Array(W * H);
	for (let i = 0; i < W * H; i++) {
		const r = img.data[i * 4];
		const g = img.data[i * 4 + 1];
		const b = img.data[i * 4 + 2];
		gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
	}

	let perimSum = 0;
	let perimCount = 0;
	let centerSum = 0;
	let centerCount = 0;
	const BORDER = 6; // 6px ring for perimeter sampling

	for (let y = 1; y < H - 1; y++) {
		for (let x = 1; x < W - 1; x++) {
			const gx = gray[y * W + (x + 1)] - gray[y * W + (x - 1)];
			const gy = gray[(y + 1) * W + x] - gray[(y - 1) * W + x];
			const mag = Math.sqrt(gx * gx + gy * gy);
			const isPerimeter = x < BORDER || x >= W - BORDER || y < BORDER || y >= H - BORDER;
			if (isPerimeter) {
				perimSum += mag;
				perimCount++;
			} else {
				centerSum += mag;
				centerCount++;
			}
		}
	}
	const perimAvg = perimCount ? perimSum / perimCount : 0;
	const centerAvg = centerCount ? centerSum / centerCount : 1;
	return perimAvg / centerAvg;
}
