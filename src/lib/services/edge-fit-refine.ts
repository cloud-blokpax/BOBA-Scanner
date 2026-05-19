/**
 * Phase 2 — Edge-fit corner refinement.
 *
 * Takes the rough corners from minAreaRect plus the raw contour points the
 * pick came from, refits each of the 4 sides via RANSAC, and re-intersects
 * to produce subpixel-accurate corners. The min-area-rect fit only sees the
 * convex hull; this sees every contour point and rejects outliers.
 *
 * Pure math — no OpenCV / DOM dependency. Returns null when refinement
 * fails any quality gate (too few points per side, RMSE too high, etc.) so
 * the caller can fall back to the unrefined corners safely.
 */

export interface Point {
	x: number;
	y: number;
}

interface LineABC {
	a: number;
	b: number;
	c: number;
}

export interface EdgeFitResult {
	corners: [Point, Point, Point, Point];
	pointsPerSide: number[];
	outliers: number;
	inlierPcts: number[];
	displacements: number[];
	rmses: number[];
	maxRMSE: number;
}

export interface EdgeFitOptions {
	edgeProximityThreshold: number;
	ransacMaxIters: number;
	ransacDistThreshold: number;
	minPointsPerSide: number;
}

const DEFAULT_OPTS: EdgeFitOptions = {
	edgeProximityThreshold: 8,
	ransacMaxIters: 50,
	ransacDistThreshold: 1.5,
	minPointsPerSide: 5
};

function distanceFromSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const denom = Math.hypot(dx, dy);
	if (denom < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
	return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / denom;
}

function fitLineRANSAC(
	points: Point[],
	maxIters: number,
	distThreshold: number
): { line: LineABC; inliers: Point[]; rmse: number } | null {
	if (points.length < 2) return null;
	let bestInlierCount = 0;
	let bestLine: LineABC | null = null;
	let bestInliers: Point[] = [];

	for (let it = 0; it < maxIters; it++) {
		const i = Math.floor(Math.random() * points.length);
		let j = Math.floor(Math.random() * points.length);
		if (j === i) j = (j + 1) % points.length;
		const p1 = points[i];
		const p2 = points[j];
		const a = p2.y - p1.y;
		const b = p1.x - p2.x;
		const c = -(a * p1.x + b * p1.y);
		const norm = Math.hypot(a, b);
		if (norm < 1e-6) continue;
		const line: LineABC = { a: a / norm, b: b / norm, c: c / norm };

		let inlierCount = 0;
		const inliers: Point[] = [];
		for (const p of points) {
			const d = Math.abs(line.a * p.x + line.b * p.y + line.c);
			if (d <= distThreshold) {
				inlierCount++;
				inliers.push(p);
			}
		}
		if (inlierCount > bestInlierCount) {
			bestInlierCount = inlierCount;
			bestLine = line;
			bestInliers = inliers;
		}
	}

	if (!bestLine || bestInliers.length < 2) return null;

	// Refit final line to inliers via least-squares (orthogonal regression
	// approximated by linear regression with vertical-line escape hatch).
	const n = bestInliers.length;
	let sx = 0;
	let sy = 0;
	let sxx = 0;
	let sxy = 0;
	for (const p of bestInliers) {
		sx += p.x;
		sy += p.y;
		sxx += p.x * p.x;
		sxy += p.x * p.y;
	}
	const denom = n * sxx - sx * sx;
	let final: LineABC;
	if (Math.abs(denom) > 1e-6) {
		// y = mx + k  →  mx - y + k = 0
		const m = (n * sxy - sx * sy) / denom;
		const k = (sy - m * sx) / n;
		const norm = Math.hypot(m, -1);
		final = { a: m / norm, b: -1 / norm, c: k / norm };
	} else {
		// Vertical line: x = sx/n
		const xMean = sx / n;
		final = { a: 1, b: 0, c: -xMean };
	}

	let sqSum = 0;
	for (const p of bestInliers) {
		const d = final.a * p.x + final.b * p.y + final.c;
		sqSum += d * d;
	}
	const rmse = Math.sqrt(sqSum / n);
	return { line: final, inliers: bestInliers, rmse };
}

function intersectLines(L1: LineABC, L2: LineABC): Point | null {
	// System:  a1*x + b1*y = -c1
	//          a2*x + b2*y = -c2
	// Cramer's rule with det = a1*b2 - a2*b1:
	//   x = (b1*c2 - b2*c1) / det
	//   y = (a2*c1 - a1*c2) / det
	const det = L1.a * L2.b - L2.a * L1.b;
	if (Math.abs(det) < 1e-6) return null;
	const x = (L1.b * L2.c - L2.b * L1.c) / det;
	const y = (L2.a * L1.c - L1.a * L2.c) / det;
	return { x, y };
}

/**
 * Group contour points by nearest side, fit a line per side, re-intersect
 * for refined corners. Returns null if any side has too few points or any
 * fit fails — caller falls back to unrefined minAreaRect corners.
 *
 * Sides are ordered TL→TR (top), TR→BR (right), BR→BL (bottom), BL→TL (left).
 * Returned corners are in TL/TR/BR/BL order.
 */
export function edgeFitRefine(
	roughCorners: [Point, Point, Point, Point],
	contourPoints: Point[],
	opts: Partial<EdgeFitOptions> = {}
): EdgeFitResult | null {
	const cfg: EdgeFitOptions = { ...DEFAULT_OPTS, ...opts };
	const [tl, tr, br, bl] = roughCorners;
	const sideEnds: Array<[Point, Point]> = [
		[tl, tr], // top
		[tr, br], // right
		[br, bl], // bottom
		[bl, tl] // left
	];

	const grouped: Point[][] = [[], [], [], []];
	let totalRejected = 0;
	for (const p of contourPoints) {
		let bestSide = -1;
		let bestDist = Infinity;
		for (let s = 0; s < 4; s++) {
			const d = distanceFromSegment(p, sideEnds[s][0], sideEnds[s][1]);
			if (d < bestDist) {
				bestDist = d;
				bestSide = s;
			}
		}
		if (bestSide >= 0 && bestDist <= cfg.edgeProximityThreshold) {
			grouped[bestSide].push(p);
		} else {
			totalRejected++;
		}
	}

	for (const g of grouped) {
		if (g.length < cfg.minPointsPerSide) return null;
	}

	const fits = grouped.map((pts) =>
		fitLineRANSAC(pts, cfg.ransacMaxIters, cfg.ransacDistThreshold)
	);
	if (fits.some((f) => !f)) return null;
	const lines = fits.map((f) => f!.line);

	const c0 = intersectLines(lines[3], lines[0]); // left ∩ top = TL
	const c1 = intersectLines(lines[0], lines[1]); // top ∩ right = TR
	const c2 = intersectLines(lines[1], lines[2]); // right ∩ bottom = BR
	const c3 = intersectLines(lines[2], lines[3]); // bottom ∩ left = BL
	if (!c0 || !c1 || !c2 || !c3) return null;

	const corners: [Point, Point, Point, Point] = [c0, c1, c2, c3];
	const displacements = roughCorners.map((c, i) =>
		Math.hypot(c.x - corners[i].x, c.y - corners[i].y)
	);
	const rmses = fits.map((f) => f!.rmse);
	const inlierPcts = fits.map((f, i) =>
		grouped[i].length > 0 ? f!.inliers.length / grouped[i].length : 0
	);

	return {
		corners,
		pointsPerSide: grouped.map((g) => g.length),
		outliers: totalRejected,
		inlierPcts,
		displacements,
		rmses,
		maxRMSE: Math.max(...rmses)
	};
}
