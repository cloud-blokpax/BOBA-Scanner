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

export const REGIONS = {
	boba: {
		card_number: { x: 0.05, y: 0.9, w: 0.45, h: 0.07 },
		hero_name: { x: 0.05, y: 0.04, w: 0.9, h: 0.1 }
	},
	wonders: {
		card_number: { x: 0.05, y: 0.93, w: 0.4, h: 0.05 },
		card_name: { x: 0.1, y: 0.05, w: 0.8, h: 0.08 },
		// Left-edge serial number strip for OCM detection
		ocm_serial: { x: 0.0, y: 0.35, w: 0.06, h: 0.3 }
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
