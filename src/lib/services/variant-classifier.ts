/**
 * Rule-based Wonders variant classifier.
 *
 * Rules, in order (most-distinctive first):
 *   1. FF: no border (edge-density on perimeter ~ edge-density on center)
 *   2. OCM: serial number "NN/NN" visible on left edge (OCR check)
 *   3. CF: diagonal hatching in border (FFT-based, TODO v1.1)
 *   4. Default: paper
 *
 * SF (Stone Foil) visual signature not yet documented — flagged as 'unknown'
 * until a sample is available.
 */

import { ocrRegion } from './paddle-ocr';
import { REGIONS, regionToPixels } from './ocr-regions';

export type WondersVariant = 'paper' | 'cf' | 'ff' | 'ocm' | 'sf' | 'unknown';

export interface VariantResult {
	variant: WondersVariant;
	ruleFired: 'ff_no_border' | 'ocm_serial_detected' | 'cf_diagonal' | 'default_paper' | 'uncertain';
	confidence: number;
	evidence: Record<string, number | string | boolean>;
}

export async function classifyWondersVariant(bitmap: ImageBitmap): Promise<VariantResult> {
	const evidence: VariantResult['evidence'] = {};

	// Rule 1: FF detection via border edge-density ratio
	const ffScore = await measureBorderVsCenterEdgeRatio(bitmap);
	evidence.border_center_edge_ratio = ffScore;
	if (ffScore < 1.25) {
		// Border doesn't differ much from center → art bleeds to edges → FF
		return {
			variant: 'ff',
			ruleFired: 'ff_no_border',
			confidence: Math.min(1, (1.4 - ffScore) * 2),
			evidence
		};
	}

	// Rule 2: OCM serial number detection
	const serialRegion = regionToPixels(REGIONS.wonders.ocm_serial, bitmap.width, bitmap.height);
	try {
		const serialOCR = await ocrRegion(bitmap, serialRegion, { minWidth: 400 });
		evidence.ocm_serial_ocr = serialOCR.text;
		const match = serialOCR.text.match(/\b(\d{1,4})\s*\/\s*(\d{1,4})\b/);
		if (match) {
			return {
				variant: 'ocm',
				ruleFired: 'ocm_serial_detected',
				confidence: Math.min(1, serialOCR.confidence + 0.2),
				evidence: { ...evidence, serial_parsed: `${match[1]}/${match[2]}` }
			};
		}
	} catch (err) {
		// Serial region OCR failed, not fatal — continue to next rule
		evidence.ocm_serial_ocr_error = String(err);
	}

	// Rule 3: CF diagonal hatching detection via FFT — TODO(2.1a.1)
	// evidence.cf_fft_peak = await measureDiagonalFrequency(bitmap);

	// Rule 4: default to paper
	return {
		variant: 'paper',
		ruleFired: 'default_paper',
		// Conservative — we didn't affirmatively detect paper, we ruled out FF/OCM.
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
