import { describe, it, expect } from 'vitest';
import { filterOutliers, calculatePriceStats } from '../src/lib/utils/pricing';

describe('filterOutliers', () => {
	it('returns all prices when fewer than 4 items', () => {
		expect(filterOutliers([1, 2, 3])).toEqual([1, 2, 3]);
	});

	it('removes outliers using IQR method', () => {
		const prices = [1, 2, 3, 4, 5, 100];
		const filtered = filterOutliers(prices);
		expect(filtered).not.toContain(100);
		expect(filtered.length).toBeLessThan(prices.length);
	});

	it('handles uniform prices', () => {
		const prices = [5, 5, 5, 5, 5];
		expect(filterOutliers(prices)).toEqual([5, 5, 5, 5, 5]);
	});
});

describe('calculatePriceStats', () => {
	it('returns null for empty array', () => {
		expect(calculatePriceStats([])).toBeNull();
	});

	it('returns null for all-zero prices', () => {
		expect(calculatePriceStats([0, 0, 0])).toBeNull();
	});

	it('calculates correct median for odd-length array', () => {
		const stats = calculatePriceStats([1, 3, 5]);
		expect(stats?.median).toBe(3);
	});

	it('calculates correct median for even-length array', () => {
		const stats = calculatePriceStats([1, 2, 3, 4]);
		expect(stats?.median).toBe(2.5);
	});

	it('filters NaN and negative values', () => {
		const stats = calculatePriceStats([NaN, -5, 10, 20, 30]);
		expect(stats).not.toBeNull();
		expect(stats!.count).toBe(3);
	});

	it('produces higher confidence with tighter spread', () => {
		const tight = calculatePriceStats([10, 10.5, 11, 10.2, 10.8, 10.3, 10.7, 10.4, 10.6, 10.1]);
		const wide = calculatePriceStats([1, 5, 10, 50, 100, 200, 500, 1, 10, 50]);
		expect(tight!.confidenceScore).toBeGreaterThan(wide!.confidenceScore);
	});
});
