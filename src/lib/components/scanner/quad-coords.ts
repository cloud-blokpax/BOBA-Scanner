/**
 * Phase 2 Doc 2.2 — Coordinate mapping for AR quad overlay.
 *
 * Detection runs on a captured ImageBitmap whose pixel coords are the
 * video's NATURAL dimensions (videoEl.videoWidth × videoEl.videoHeight).
 * The SVG overlay renders in CSS pixels relative to the video element's
 * bounding rect. With `object-fit: cover` (the camera-feed default), the
 * video texture fills the element's box and overflows on whichever axis
 * has the wrong aspect — that crop must be undone.
 *
 * Pure helpers, no DOM. Caller passes in the measured layout.
 */

export interface Pt { x: number; y: number; }

export interface VideoLayout {
	/** Natural video dimensions (videoEl.videoWidth/Height). */
	naturalW: number;
	naturalH: number;
	/** Element CSS dimensions (clientWidth/clientHeight). */
	displayedW: number;
	displayedH: number;
	/** object-fit treatment. Camera feed is 'cover'. */
	fit: 'cover' | 'contain';
}

/**
 * Map a bitmap-space point (pixels in the natural video frame) to a
 * CSS-space point (pixels in the displayed video element). Returns null
 * if the layout is degenerate.
 */
export function mapBitmapPointToCss(p: Pt, layout: VideoLayout): Pt | null {
	const { naturalW, naturalH, displayedW, displayedH, fit } = layout;
	if (naturalW <= 0 || naturalH <= 0 || displayedW <= 0 || displayedH <= 0) return null;

	const naturalAspect = naturalW / naturalH;
	const displayedAspect = displayedW / displayedH;

	// 'cover' = scale up so the smaller axis fills, then crop overflow.
	// 'contain' = scale down so the larger axis fits, with letterboxing.
	let scale: number;
	let offsetXcss = 0;
	let offsetYcss = 0;

	if (fit === 'cover') {
		if (naturalAspect > displayedAspect) {
			// Natural is wider → fit by height, crop horizontally
			scale = displayedH / naturalH;
			offsetXcss = (displayedW - naturalW * scale) / 2;
		} else {
			// Natural is taller → fit by width, crop vertically
			scale = displayedW / naturalW;
			offsetYcss = (displayedH - naturalH * scale) / 2;
		}
	} else {
		if (naturalAspect > displayedAspect) {
			scale = displayedW / naturalW;
			offsetYcss = (displayedH - naturalH * scale) / 2;
		} else {
			scale = displayedH / naturalH;
			offsetXcss = (displayedW - naturalW * scale) / 2;
		}
	}

	return {
		x: p.x * scale + offsetXcss,
		y: p.y * scale + offsetYcss
	};
}

/**
 * Map an array of bitmap points; returns null if any single point fails
 * (degenerate layout).
 */
export function mapBitmapQuadToCss(
	corners: [Pt, Pt, Pt, Pt],
	layout: VideoLayout
): [Pt, Pt, Pt, Pt] | null {
	const out: Pt[] = [];
	for (const c of corners) {
		const m = mapBitmapPointToCss(c, layout);
		if (!m) return null;
		out.push(m);
	}
	return out as [Pt, Pt, Pt, Pt];
}

/**
 * Exponential moving average on each corner. α weights the new sample.
 * α=0.5 is a good default — visibly smooth but still responsive at 4Hz.
 *
 * Caller owns `prev` (previous-tick smoothed corners or null on first
 * detection). Returns the new smoothed quad. Pass-through when prev is null.
 */
export function smoothQuad(
	next: [Pt, Pt, Pt, Pt],
	prev: [Pt, Pt, Pt, Pt] | null,
	alpha = 0.5
): [Pt, Pt, Pt, Pt] {
	if (!prev) return next;
	const lerp = (a: number, b: number) => a * (1 - alpha) + b * alpha;
	return [
		{ x: lerp(prev[0].x, next[0].x), y: lerp(prev[0].y, next[0].y) },
		{ x: lerp(prev[1].x, next[1].x), y: lerp(prev[1].y, next[1].y) },
		{ x: lerp(prev[2].x, next[2].x), y: lerp(prev[2].y, next[2].y) },
		{ x: lerp(prev[3].x, next[3].x), y: lerp(prev[3].y, next[3].y) }
	] as [Pt, Pt, Pt, Pt];
}

/**
 * Build an SVG path `d` attribute from 4 ordered points. Closed polygon.
 */
export function quadToSvgPath(corners: [Pt, Pt, Pt, Pt]): string {
	return `M ${corners[0].x.toFixed(1)} ${corners[0].y.toFixed(1)} `
		+ `L ${corners[1].x.toFixed(1)} ${corners[1].y.toFixed(1)} `
		+ `L ${corners[2].x.toFixed(1)} ${corners[2].y.toFixed(1)} `
		+ `L ${corners[3].x.toFixed(1)} ${corners[3].y.toFixed(1)} `
		+ `Z`;
}
