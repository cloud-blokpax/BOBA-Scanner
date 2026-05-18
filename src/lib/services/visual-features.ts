/**
 * Phase 3 — Visual feature extraction for parallel disambiguation.
 *
 * Samples the border-color of the rectified canonical crop and maps it to
 * the nearest known parallel via L*a*b distance. The result is fed to
 * catalog lookup as a HINT (bonus score) — never as a filter. Color
 * matching is noisy at low confidence (small `margin_to_2nd`) so the
 * catalog only acts on it when the winner is decisive.
 *
 * Reference `PARALLEL_BORDER_REFS` are initial guesses; recalibrate from
 * telemetry after deploy (see CLAUDE.md / phase doc verification SQL).
 *
 * Pure functions — no I/O, no DOM dependence beyond OffscreenCanvas.
 */

const BORDER_SAMPLE_WIDTH = 8;

export interface LabColor {
	L: number;
	a: number;
	b: number;
}

export interface ParallelColorMatch {
	code: string;
	distance: number;
	margin_to_2nd: number;
}

/**
 * Sample the mean L*a*b color from the 4 border strips of the canonical
 * crop. Strip width is BORDER_SAMPLE_WIDTH px on each side; corners are
 * counted once (top + bottom strips own them).
 */
export async function sampleBorderColorLab(canonical: ImageBitmap): Promise<LabColor> {
	const w = canonical.width;
	const h = canonical.height;
	const canvas = new OffscreenCanvas(w, h);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
	ctx.drawImage(canonical, 0, 0);
	const data = ctx.getImageData(0, 0, w, h).data;
	const b = Math.min(BORDER_SAMPLE_WIDTH, Math.floor(Math.min(w, h) / 4));

	let R = 0;
	let G = 0;
	let B = 0;
	let count = 0;

	// Top strip (full width)
	for (let y = 0; y < b; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			R += data[i];
			G += data[i + 1];
			B += data[i + 2];
			count++;
		}
	}
	// Bottom strip (full width)
	for (let y = h - b; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			R += data[i];
			G += data[i + 1];
			B += data[i + 2];
			count++;
		}
	}
	// Left + right strips (excluding the corners already counted above)
	for (let y = b; y < h - b; y++) {
		for (let x = 0; x < b; x++) {
			const i = (y * w + x) * 4;
			R += data[i];
			G += data[i + 1];
			B += data[i + 2];
			count++;
		}
		for (let x = w - b; x < w; x++) {
			const i = (y * w + x) * 4;
			R += data[i];
			G += data[i + 1];
			B += data[i + 2];
			count++;
		}
	}

	return rgbToLab(R / count, G / count, B / count);
}

export function rgbToLab(r: number, g: number, b: number): LabColor {
	const linearize = (c: number): number => {
		const cn = c / 255;
		return cn > 0.04045 ? Math.pow((cn + 0.055) / 1.055, 2.4) : cn / 12.92;
	};
	const R = linearize(r);
	const G = linearize(g);
	const B = linearize(b);

	let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
	let Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
	let Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;

	// D65 reference white
	X /= 0.95047;
	Y /= 1.0;
	Z /= 1.08883;

	const fy = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116);
	const L = 116 * fy(Y) - 16;
	const a = 500 * (fy(X) - fy(Y));
	const bComp = 200 * (fy(Y) - fy(Z));
	return { L, a, b: bComp };
}

/**
 * Initial reference L*a*b values per BoBA parallel border. INITIAL GUESSES —
 * recalibrate from telemetry once we have border_color_lab data joined to
 * confirmed cards.parallel rows. See phase doc verification SQL.
 */
const PARALLEL_BORDER_REFS: ReadonlyArray<{ code: string; lab: LabColor }> = [
	{ code: 'BF', lab: { L: 78, a: 2, b: 35 } }, // gold/yellow Battlefoil
	{ code: 'RBF', lab: { L: 55, a: 55, b: 25 } }, // red Battlefoil
	{ code: 'OBF', lab: { L: 70, a: 35, b: 60 } }, // orange Battlefoil
	{ code: 'SBF', lab: { L: 82, a: 0, b: -3 } }, // silver Battlefoil
	{ code: 'BBF', lab: { L: 50, a: 10, b: -55 } }, // blue Battlefoil
	{ code: 'BLBF', lab: { L: 25, a: 0, b: -2 } } // black Battlefoil
];

/**
 * Match a sampled L*a*b border color to the nearest known parallel.
 * Returns the code, raw distance, and margin to the second-nearest match.
 * Callers should require margin_to_2nd above a threshold (~5-8 dE) before
 * acting on the hint.
 */
export function nearestParallelByBorderColor(lab: LabColor): ParallelColorMatch {
	if (PARALLEL_BORDER_REFS.length === 0) {
		return { code: '', distance: Infinity, margin_to_2nd: 0 };
	}
	let best = PARALLEL_BORDER_REFS[0];
	let bestDist = Infinity;
	let secondDist = Infinity;
	for (const ref of PARALLEL_BORDER_REFS) {
		const d = Math.sqrt(
			(lab.L - ref.lab.L) ** 2 +
				(lab.a - ref.lab.a) ** 2 +
				(lab.b - ref.lab.b) ** 2
		);
		if (d < bestDist) {
			secondDist = bestDist;
			bestDist = d;
			best = ref;
		} else if (d < secondDist) {
			secondDist = d;
		}
	}
	return {
		code: best.code,
		distance: bestDist,
		margin_to_2nd: secondDist === Infinity ? bestDist : secondDist - bestDist
	};
}
