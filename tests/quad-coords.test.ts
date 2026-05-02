import { describe, it, expect } from 'vitest';
import {
	mapBitmapPointToCss,
	smoothQuad,
	quadToSvgPath,
	type VideoLayout,
	type Pt
} from '../src/lib/components/scanner/quad-coords';

describe('mapBitmapPointToCss — object-fit cover', () => {
	it('identity when natural and displayed sizes match', () => {
		const layout: VideoLayout = {
			naturalW: 1000, naturalH: 1500,
			displayedW: 1000, displayedH: 1500,
			fit: 'cover'
		};
		const r = mapBitmapPointToCss({ x: 500, y: 750 }, layout);
		expect(r).toEqual({ x: 500, y: 750 });
	});

	it('scales uniformly when aspect matches', () => {
		const layout: VideoLayout = {
			naturalW: 1000, naturalH: 1500,
			displayedW: 500, displayedH: 750,
			fit: 'cover'
		};
		const r = mapBitmapPointToCss({ x: 400, y: 600 }, layout);
		expect(r?.x).toBeCloseTo(200);
		expect(r?.y).toBeCloseTo(300);
	});

	it('crops horizontally when natural is wider than displayed', () => {
		// Natural 16:9 video in a 9:16 portrait container with cover.
		// Vertical fills, horizontal overflows on both sides.
		const layout: VideoLayout = {
			naturalW: 1600, naturalH: 900,
			displayedW: 360, displayedH: 640,
			fit: 'cover'
		};
		// Center of natural frame should land at center of displayed.
		const center = mapBitmapPointToCss({ x: 800, y: 450 }, layout);
		expect(center?.x).toBeCloseTo(180);
		expect(center?.y).toBeCloseTo(320);
		// Far-left of natural maps to a NEGATIVE CSS x (off-screen).
		const left = mapBitmapPointToCss({ x: 0, y: 450 }, layout);
		expect(left?.x).toBeLessThan(0);
	});

	it('crops vertically when natural is taller than displayed', () => {
		const layout: VideoLayout = {
			naturalW: 900, naturalH: 1600,
			displayedW: 640, displayedH: 360,
			fit: 'cover'
		};
		const center = mapBitmapPointToCss({ x: 450, y: 800 }, layout);
		expect(center?.x).toBeCloseTo(320);
		expect(center?.y).toBeCloseTo(180);
	});

	it('returns null on degenerate layout', () => {
		expect(mapBitmapPointToCss({ x: 1, y: 1 }, {
			naturalW: 0, naturalH: 100, displayedW: 100, displayedH: 100, fit: 'cover'
		})).toBeNull();
	});
});

describe('smoothQuad', () => {
	const A: [Pt, Pt, Pt, Pt] = [
		{ x: 0, y: 0 }, { x: 10, y: 0 },
		{ x: 10, y: 10 }, { x: 0, y: 10 }
	];
	const B: [Pt, Pt, Pt, Pt] = [
		{ x: 2, y: 2 }, { x: 12, y: 2 },
		{ x: 12, y: 12 }, { x: 2, y: 12 }
	];

	it('returns next as-is when prev is null', () => {
		expect(smoothQuad(B, null)).toEqual(B);
	});

	it('with α=0.5 averages the two', () => {
		const r = smoothQuad(B, A, 0.5);
		expect(r[0].x).toBeCloseTo(1);
		expect(r[2].y).toBeCloseTo(11);
	});

	it('with α=1 returns next exactly', () => {
		const r = smoothQuad(B, A, 1);
		expect(r).toEqual(B);
	});

	it('with α=0 returns prev exactly', () => {
		const r = smoothQuad(B, A, 0);
		expect(r).toEqual(A);
	});
});

describe('quadToSvgPath', () => {
	it('builds a closed M/L/L/L/Z path', () => {
		const corners: [Pt, Pt, Pt, Pt] = [
			{ x: 1, y: 2 }, { x: 3, y: 4 },
			{ x: 5, y: 6 }, { x: 7, y: 8 }
		];
		const d = quadToSvgPath(corners);
		expect(d).toBe('M 1.0 2.0 L 3.0 4.0 L 5.0 6.0 L 7.0 8.0 Z');
	});
});
