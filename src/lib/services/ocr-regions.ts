/**
 * Canonical-pixel-coord OCR regions.
 *
 * Pre-rebuild this file held normalized (0-1) fractions of the frame. With
 * the geometry rebuild (Doc 1), the canonical image is a rectified 750×1050
 * card surface — coordinates here express where each field is on the PHYSICAL
 * card, in canonical pixels (12 px/mm).
 *
 * Why pixel coords now, not fractions:
 *   - The rectified canonical is a known-fixed 750×1050. Fractions just
 *     mean "multiply by 750 or 1050" everywhere; it's noise.
 *   - Phase 4 (rec-only) wants exact pixel boxes to skip PaddleOCR's slow
 *     detection model and run rec head directly. Fractions add an extra
 *     conversion step in the hot path.
 *
 * Region tuning rationale (preserved from pre-rebuild measurements):
 *   - BoBA hero names: avg 8 chars, max 23 ("Barry 'Cutback' Sanders").
 *     55% width ≈ 412 px fits all observed names.
 *   - Wonders card names: avg 17 chars, max 35. Wider region — 70% ≈ 525 px.
 *   - card_number left-anchored on both games; 30% ≈ 225 px covers
 *     "GLBF-170" and "A1-028/401" with margin.
 *   - set_code (BoBA only) lives bottom-left as the year stamp ("2026").
 */

export interface Region {
	x: number;
	y: number;
	w: number;
	h: number;
}

import { CANONICAL_W, CANONICAL_H } from './upload-card-detector';

export const REGIONS = {
	boba: {
		card_number: { x: 30,  y: 966,  w: 225, h: 63  },
		hero_name:   { x: 30,  y: 42,   w: 412, h: 105 },
		set_code:    { x: 30,  y: 1008, w: 90,  h: 36  }
	},
	wonders: {
		card_number: { x: 30,  y: 987,  w: 225, h: 53  },
		card_name:   { x: 38,  y: 53,   w: 525, h: 84  },
		ocm_serial:  { x: 0,   y: 367,  w: 45,  h: 315 }
	}
} as const;

/**
 * Region pixel rectangle, ready to feed to PaddleOCR or to crop a sub-bitmap.
 *
 * Expects a canonical-sized bitmap (w === CANONICAL_W, h === CANONICAL_H).
 * If passed a non-canonical bitmap, scales linearly — preserves backwards
 * compatibility with any caller still passing pre-rebuild canvases.
 */
export function regionToPixels(
	region: Region,
	w: number,
	h: number
): { x: number; y: number; w: number; h: number } {
	if (w === CANONICAL_W && h === CANONICAL_H) {
		return {
			x: Math.max(0, Math.min(region.x, w - 1)),
			y: Math.max(0, Math.min(region.y, h - 1)),
			w: Math.min(region.w, w - region.x),
			h: Math.min(region.h, h - region.y)
		};
	}
	const sx = w / CANONICAL_W;
	const sy = h / CANONICAL_H;
	return {
		x: Math.round(region.x * sx),
		y: Math.round(region.y * sy),
		w: Math.round(region.w * sx),
		h: Math.round(region.h * sy)
	};
}
