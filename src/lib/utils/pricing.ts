/**
 * Pricing statistics utilities.
 *
 * Uses median over mean and IQR-based outlier filtering
 * for robust card price estimation from noisy eBay data.
 */

export interface PriceStats {
	median: number;
	mean: number;
	low: number;
	high: number;
	count: number;
	/** How many listings survived outlier filtering */
	filteredCount: number;
	/** 0–1 score: higher = more data, more agreement between listings */
	confidenceScore: number;
}

/**
 * Filter outliers using the Interquartile Range (IQR) method.
 * Removes values below Q1 - 1.5*IQR and above Q3 + 1.5*IQR.
 */
export function filterOutliers(prices: number[]): number[] {
	if (prices.length < 4) return prices;

	const sorted = [...prices].sort((a, b) => a - b);
	const q1Index = Math.floor(sorted.length * 0.25);
	const q3Index = Math.floor(sorted.length * 0.75);
	const q1 = sorted[q1Index];
	const q3 = sorted[q3Index];
	const iqr = q3 - q1;

	const lowerBound = q1 - 1.5 * iqr;
	const upperBound = q3 + 1.5 * iqr;

	return sorted.filter(p => p >= lowerBound && p <= upperBound);
}

/**
 * Calculate robust price statistics from a set of listing prices.
 */
export function calculatePriceStats(rawPrices: number[]): PriceStats | null {
	const valid = rawPrices.filter(p => !isNaN(p) && p > 0);
	if (valid.length === 0) return null;

	const filtered = filterOutliers(valid);
	if (filtered.length === 0) return null;

	const sorted = [...filtered].sort((a, b) => a - b);
	const median = sorted.length % 2 === 0
		? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
		: sorted[Math.floor(sorted.length / 2)];

	const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;

	// Confidence: more listings + tighter spread = higher confidence
	const spread = sorted.length > 1 && median > 0
		? (sorted[sorted.length - 1] - sorted[0]) / median
		: 1;
	const volumeScore = Math.min(sorted.length / 10, 1); // maxes at 10 listings
	const spreadScore = Math.max(0, 1 - spread / 2);     // penalize wide spreads
	const confidenceScore = parseFloat((volumeScore * 0.6 + spreadScore * 0.4).toFixed(2));

	return {
		median: parseFloat(median.toFixed(2)),
		mean: parseFloat(mean.toFixed(2)),
		low: parseFloat(sorted[0].toFixed(2)),
		high: parseFloat(sorted[sorted.length - 1].toFixed(2)),
		count: valid.length,
		filteredCount: sorted.length,
		confidenceScore
	};
}
