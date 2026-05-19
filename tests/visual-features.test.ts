import { describe, expect, it } from 'vitest';
import {
	nearestParallelByBorderColor,
	rgbToLab
} from '../src/lib/services/visual-features';

describe('rgbToLab', () => {
	it('returns L≈100 for white', () => {
		const lab = rgbToLab(255, 255, 255);
		expect(lab.L).toBeGreaterThan(99.5);
		expect(Math.abs(lab.a)).toBeLessThan(2);
		expect(Math.abs(lab.b)).toBeLessThan(2);
	});

	it('returns L≈0 for black', () => {
		const lab = rgbToLab(0, 0, 0);
		expect(lab.L).toBeLessThan(0.5);
	});

	it('returns positive a* for red', () => {
		const lab = rgbToLab(220, 30, 30);
		expect(lab.a).toBeGreaterThan(40);
	});

	it('returns negative b* for blue', () => {
		const lab = rgbToLab(40, 80, 200);
		expect(lab.b).toBeLessThan(-30);
	});
});

describe('nearestParallelByBorderColor', () => {
	it('matches gold-ish color to BF (yellow Battlefoil)', () => {
		// Approximate gold/yellow Lab values (L:78, a:2, b:35)
		const m = nearestParallelByBorderColor({ L: 80, a: 3, b: 33 });
		expect(m.code).toBe('BF');
		expect(m.distance).toBeLessThan(10);
	});

	it('matches dark color to BLBF (black Battlefoil)', () => {
		const m = nearestParallelByBorderColor({ L: 22, a: 1, b: -1 });
		expect(m.code).toBe('BLBF');
	});

	it('returns positive margin when winner is clearly best', () => {
		const m = nearestParallelByBorderColor({ L: 80, a: 3, b: 33 });
		expect(m.margin_to_2nd).toBeGreaterThan(0);
	});

	it('matches red color to RBF', () => {
		const m = nearestParallelByBorderColor({ L: 55, a: 55, b: 25 });
		expect(m.code).toBe('RBF');
		expect(m.distance).toBeLessThan(1);
	});
});
