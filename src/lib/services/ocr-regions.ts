/**
 * Normalized (0-1) crop coordinates for card_number and name regions,
 * measured relative to the viewfinder-cropped card frame.
 *
 * Assumes card is vertically oriented with 5:7 aspect. These are starting
 * estimates based on typical trading-card layouts — expect empirical tuning
 * after validation test images arrive.
 */

export interface Region {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Tightened post-2.1c. Previous regions were full-width top/bottom strips,
 * which on imperfect crops swept in "1ST EDITION" stamps, power values, and
 * set symbols — those reads then competed in consensus voting.
 *
 * Empirical bounds:
 *   - BoBA hero names: avg 8 chars, max 23 ("Barry 'Cutback' Sanders").
 *     Top-left 55% width fits all observed names with margin.
 *   - Wonders card names: avg 17 chars, max 35 ("Jarthex Pyrethane, Lord of
 *     Darkiron"). Need wider region — 70% width — to avoid clipping the
 *     longest names while still excluding the cost circle on the right edge.
 *   - card_number is left-anchored on both games; 30% width covers
 *     "GLBF-170" and "A1-028/401" with margin.
 */
export const REGIONS = {
	boba: {
		card_number: { x: 0.04, y: 0.92, w: 0.30, h: 0.06 },
		hero_name:   { x: 0.04, y: 0.04, w: 0.55, h: 0.10 }
	},
	wonders: {
		card_number: { x: 0.04, y: 0.94, w: 0.30, h: 0.05 },
		card_name:   { x: 0.05, y: 0.05, w: 0.70, h: 0.08 },
		// Left-edge serial number strip for OCM detection (unchanged)
		ocm_serial:  { x: 0.0,  y: 0.35, w: 0.06, h: 0.30 }
	}
} as const;

export function regionToPixels(
	region: Region,
	w: number,
	h: number
): { x: number; y: number; w: number; h: number } {
	return {
		x: Math.round(region.x * w),
		y: Math.round(region.y * h),
		w: Math.round(region.w * w),
		h: Math.round(region.h * h)
	};
}
