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

/**
 * Card-relative pixel coords on the rectified 750×1050 canonical (12 px/mm).
 *
 * Re-measured in Doc 1.1 against the actual physical card layout — Doc 1's
 * coords were a mechanical conversion from old fractional bounds that
 * assumed canonical-fills-frame, not canonical-is-card.
 *
 * Reference card: BoBA Griffey Edition Hero (BBF-82 Dumper, BF-88 Escape Artist)
 * and Wonders Existence (350/401 Lunar Empowerment, 279/401 Punish).
 *
 * Margins use 4mm = 48px. Card text-region heights are deliberately generous
 * (3-7mm tall depending on field) — region-OCR upsamples internally and a
 * slightly oversized box is far better than a slightly undersized one.
 */
export const REGIONS = {
	boba: {
		// Bottom-left card_number stamp. "BBF-82" / "BF-88" / "PL-71" / "GLBF-170".
		card_number: { x: 48,  y: 1008, w: 216, h: 48  },
		// Top-left hero name. Up to 23 chars ("Barry 'Cutback' Sanders").
		hero_name:   { x: 48,  y: 48,   w: 456, h: 72  },
		// "2026" year stamp below card_number.
		set_code:    { x: 48,  y: 1032, w: 96,  h: 36  }
	},
	wonders: {
		// Bottom-left "279/401" / "350/401" — print-run notation.
		card_number: { x: 48,  y: 1004, w: 216, h: 36  },
		// Top card name, up to 35 chars ("Jarthex Pyrethane, Lord of Darkiron").
		card_name:   { x: 60,  y: 60,   w: 528, h: 84  },
		// Left-edge serial strip (vertical) for OCM detection.
		ocr_serial:  { x: 0,   y: 367,  w: 45,  h: 315 }
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
