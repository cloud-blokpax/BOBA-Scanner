/**
 * Fuzzy matching utilities for card recognition cross-validation.
 *
 * Used by Tier 3 (Claude AI) to validate AI-returned card numbers
 * and hero names against the local card database.
 */

/**
 * Trigram similarity for card numbers (e.g., "THA-7" vs "THA-17").
 * Returns 0–1 score where 1 = identical.
 */
export function trigramSimilarity(a: string, b: string): number {
	const trigramsA = getTrigrams(a.toLowerCase());
	const trigramsB = getTrigrams(b.toLowerCase());

	if (trigramsA.size === 0 && trigramsB.size === 0) return 1;
	if (trigramsA.size === 0 || trigramsB.size === 0) return 0;

	let intersection = 0;
	for (const trigram of trigramsA) {
		if (trigramsB.has(trigram)) intersection++;
	}

	return intersection / (trigramsA.size + trigramsB.size - intersection);
}

function getTrigrams(str: string): Set<string> {
	const padded = `  ${str} `;
	const trigrams = new Set<string>();
	for (let i = 0; i < padded.length - 2; i++) {
		trigrams.add(padded.substring(i, i + 3));
	}
	return trigrams;
}

/**
 * Fuzzy name matching for hero names.
 * Handles common OCR/AI misreads and partial matches.
 * Returns 0–1 score where 1 = identical.
 */
export function fuzzyNameMatch(dbName: string, aiName: string): number {
	const a = normalizeName(dbName);
	const b = normalizeName(aiName);

	if (a === b) return 1;

	// Check if one contains the other
	// (handles "Highway to Helton" vs "Highway To Helton - Todd Helton Debut")
	if (a.includes(b) || b.includes(a)) {
		const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
		return Math.max(0.9, ratio);
	}

	// Levenshtein-based similarity
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;
	const distance = levenshtein(a, b);
	return 1 - distance / maxLen;
}

function normalizeName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, '') // strip punctuation
		.replace(/\s+/g, ' ')        // collapse whitespace
		.trim();
}

function levenshtein(a: string, b: string): number {
	const matrix: number[][] = [];
	for (let i = 0; i <= a.length; i++) matrix[i] = [i];
	for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1,
				matrix[i][j - 1] + 1,
				matrix[i - 1][j - 1] + cost
			);
		}
	}
	return matrix[a.length][b.length];
}
