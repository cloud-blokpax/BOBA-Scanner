import { describe, expect, it } from 'vitest';
import { edgeFitRefine, type Point } from '../src/lib/services/edge-fit-refine';

/**
 * Generate a synthetic contour around a known rectangle, with optional
 * jitter on each side. We then perturb the rough corners slightly and
 * verify edge-fit recovers something close to the truth.
 */
function rectContour(
	tl: Point,
	br: Point,
	pointsPerSide: number,
	jitter: number = 0,
	rng: () => number = Math.random
): Point[] {
	const out: Point[] = [];
	const tr = { x: br.x, y: tl.y };
	const bl = { x: tl.x, y: br.y };
	const sides: Array<[Point, Point]> = [
		[tl, tr],
		[tr, br],
		[br, bl],
		[bl, tl]
	];
	for (const [a, b] of sides) {
		for (let i = 0; i < pointsPerSide; i++) {
			const t = i / (pointsPerSide - 1);
			out.push({
				x: a.x + (b.x - a.x) * t + (rng() - 0.5) * jitter,
				y: a.y + (b.y - a.y) * t + (rng() - 0.5) * jitter
			});
		}
	}
	return out;
}

function seededRng(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

describe('edgeFitRefine', () => {
	it('recovers tight corners from a clean rectangle', () => {
		const rng = seededRng(42);
		const points = rectContour({ x: 100, y: 100 }, { x: 500, y: 700 }, 50, 0.5, rng);
		const roughCorners: [Point, Point, Point, Point] = [
			{ x: 102, y: 103 },
			{ x: 498, y: 101 },
			{ x: 501, y: 702 },
			{ x: 99, y: 698 }
		];
		const fit = edgeFitRefine(roughCorners, points);
		expect(fit).not.toBeNull();
		// Sub-3px accuracy with 0.5px input jitter.
		expect(fit!.corners[0].x).toBeGreaterThan(97);
		expect(fit!.corners[0].x).toBeLessThan(103);
		expect(fit!.corners[0].y).toBeGreaterThan(97);
		expect(fit!.corners[0].y).toBeLessThan(103);
		expect(fit!.corners[2].x).toBeGreaterThan(497);
		expect(fit!.corners[2].x).toBeLessThan(503);
		expect(fit!.corners[2].y).toBeGreaterThan(697);
		expect(fit!.corners[2].y).toBeLessThan(703);
		// RMSE roughly tracks jitter (0.5px input).
		expect(fit!.maxRMSE).toBeLessThan(2);
	});

	it('returns null when a side has too few points', () => {
		// Generate only top + right sides → bottom + left empty
		const points: Point[] = [];
		for (let i = 0; i < 20; i++) points.push({ x: 100 + i * 20, y: 100 });
		for (let i = 0; i < 20; i++) points.push({ x: 500, y: 100 + i * 30 });
		const roughCorners: [Point, Point, Point, Point] = [
			{ x: 100, y: 100 },
			{ x: 500, y: 100 },
			{ x: 500, y: 700 },
			{ x: 100, y: 700 }
		];
		expect(edgeFitRefine(roughCorners, points)).toBeNull();
	});

	it('handles axis-aligned vertical sides without singularity', () => {
		// Specifically tests the verticality escape hatch in fitLineRANSAC.
		// Previously a bug in intersectLines flipped sign on /det → x=-100.
		const rng = seededRng(11);
		const points = rectContour({ x: 200, y: 50 }, { x: 800, y: 1050 }, 60, 0.3, rng);
		const roughCorners: [Point, Point, Point, Point] = [
			{ x: 199, y: 49 },
			{ x: 801, y: 51 },
			{ x: 802, y: 1049 },
			{ x: 198, y: 1051 }
		];
		const fit = edgeFitRefine(roughCorners, points);
		expect(fit).not.toBeNull();
		expect(fit!.corners[0].x).toBeGreaterThan(198);
		expect(fit!.corners[0].x).toBeLessThan(202);
	});
});
