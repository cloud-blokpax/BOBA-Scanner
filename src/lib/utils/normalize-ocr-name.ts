/**
 * OCR name normalization — pure helpers extracted from catalog-mirror.ts
 * so unit tests can import without pulling Supabase / IDB.
 *
 * Handles the two empirically-observed PaddleOCR quirks from Phase 2
 * validation:
 *   - Space drops in kerned title fonts ("CastOut" ↔ "Cast Out")
 *   - 0↔o and 1↔l confusion in small digits in names ("A-9o" ↔ "A-90")
 *
 * Applied symmetrically to both sides of a comparison, this normalization
 * is distance-preserving for genuine character differences and eliminates
 * the two quirks.
 */

export function normalizeOcrName(s: string): string {
	return s
		.toLowerCase()
		.replace(/\s+/g, '')
		.replace(/o/g, '0')
		.replace(/l/g, '1');
}

export function levenshtein(a: string, b: string): number {
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const m: number[][] = [];
	for (let i = 0; i <= b.length; i++) m[i] = [i];
	for (let j = 0; j <= a.length; j++) m[0][j] = j;
	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			const cost = a[j - 1] === b[i - 1] ? 0 : 1;
			m[i][j] = Math.min(
				m[i - 1][j] + 1,
				m[i][j - 1] + 1,
				m[i - 1][j - 1] + cost
			);
		}
	}
	return m[b.length][a.length];
}
