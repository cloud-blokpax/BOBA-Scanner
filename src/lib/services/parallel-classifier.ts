/**
 * Rule-based Wonders parallel classifier.
 *
 * Rules, in order (most-distinctive first):
 *   1. FF: no border (edge-density on perimeter ~ edge-density on center)
 *   2. OCM: left-edge serial "NN/99" visible in full-frame OCR output
 *   3. Stonefoil / 1-of-1: "ONE OF ONE" text visible (OCR drops middle "OF"
 *      on gold-on-black kerning; regex accepts "ONEONE" too)
 *   4. CF: diagonal hatching in border (FFT — stubbed, 2.1a.1 follow-up)
 *   5. Default: paper
 *
 * IMPORTANT: This classifier outputs SHORT CODES ('cf', 'ff', 'ocm', 'sf',
 * 'paper'). Short codes are internal-only. Every DB write path must map
 * the code to a human-readable name (via `WONDERS_PARALLEL_NAMES` re-
 * exported below, or `toParallelName()` from `$lib/data/wonders-parallels`)
 * before persisting.
 */

import { ocrFullFrame } from './paddle-ocr';
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
		| 'ocm_serial_detected'
		| 'sf_one_of_one'
		| 'cf_diagonal'
		| 'default_paper'
		| 'uncertain';
	confidence: number;
	evidence: Record<string, number | string | boolean>;
}

export async function classifyWondersParallel(bitmap: ImageBitmap): Promise<ParallelResult> {
	const evidence: ParallelResult['evidence'] = {};

	// Rule 1: FF detection via border edge-density ratio (pixel-level)
	const ffScore = await measureBorderVsCenterEdgeRatio(bitmap);
	evidence.border_center_edge_ratio = Number(ffScore.toFixed(3));
	if (ffScore < 1.25) {
		// Border doesn't differ much from center → art bleeds to edges → FF
		return {
			parallel: 'ff',
			ruleFired: 'ff_no_border',
			confidence: Math.min(1, (1.4 - ffScore) * 2),
			evidence
		};
	}

	// Rules 2 + 3: one full-frame OCR powers both the OCM NN/99 serial lookup
	// and the Stonefoil ONE-OF-ONE text lookup. Cheaper than two region reads
	// and more robust to tiny left-edge coord drift.
	let fullFrameText = '';
	try {
		const ocr = await ocrFullFrame(bitmap, { maxLongEdge: 1800 });
		fullFrameText = ocr.boxes.map((b) => b.text).join(' | ');
		evidence.full_frame_ocr_box_count = ocr.boxes.length;
	} catch (err) {
		evidence.full_frame_ocr_error = String(err);
	}

	const textUpper = fullFrameText.toUpperCase();
	const textNoSpace = textUpper.replace(/\s+/g, '');

	// Rule 2: OCM — left-edge "NN/99" serial.
	// Validated on Cast Out OCM: OCR read "66/99" at conf 0.97.
	const ocmMatch = textUpper.match(/\b(\d{1,3})\s*\/\s*99\b/);
	if (ocmMatch) {
		evidence.ocm_serial = `${ocmMatch[1]}/99`;
		return {
			parallel: 'ocm',
			ruleFired: 'ocm_serial_detected',
			confidence: 0.95,
			evidence
		};
	}

	// Rule 3: Stonefoil / 1-of-1 — "ONE OF ONE" text on left-edge strip.
	// Validated on Cast Out Stonefoil: OCR read "ONEONE" at conf 0.99 — the
	// middle "OF" is consistently dropped in the gold-on-black kerned text,
	// so the regex accepts both forms.
	if (/ONE\s*(?:OF\s*)?ONE/.test(textUpper) || /ONEONE/.test(textNoSpace)) {
		evidence.one_of_one_detected = true;
		return {
			parallel: 'sf',
			ruleFired: 'sf_one_of_one',
			confidence: 0.95,
			evidence
		};
	}

	// Rule 4: CF diagonal hatching — stubbed for v1.
	// TODO(2.1a.1): FFT peak detection on top/bottom border strips.

	// Rule 5: default to paper.
	return {
		parallel: 'paper',
		ruleFired: 'default_paper',
		// Conservative — we didn't affirmatively detect paper, we ruled out
		// FF / OCM / Stonefoil via the distinctive signals.
		confidence: 0.7,
		evidence
	};
}

/**
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
