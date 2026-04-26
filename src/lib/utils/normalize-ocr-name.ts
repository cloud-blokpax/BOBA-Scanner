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

/**
 * Strip card-edition stamps that appear alongside the hero/card name in the
 * top-left region. PaddleOCR reads stamp + name as one string (possibly
 * merged into one OCR box if they're on the same baseline), and the
 * concatenated string blows past the Levenshtein threshold for short hero
 * names like "Burrocious" (10 chars, threshold 2).
 *
 * Patterns tolerate OCR artifacts: missing leading characters ("IRST" for
 * "FIRST"), digit-letter confusion ("1ST" for "1ST"), and stray punctuation.
 *
 * Applied to OCR text before name-normalization in two places:
 *   - consensus-builder.ts → collapseName (drives canonical Tier 1 + TTA)
 *   - catalog-mirror.ts → lookupCardByCardNumberFuzzy (drives Tier 1
 *     fallback when name doesn't collapse cleanly but cardNumber is solid)
 *
 * Extend STAMP_PATTERNS as new printed stamps surface in scan telemetry.
 * Each pattern should be word-boundary anchored on the END side and
 * tolerant on the START side (OCR drops leading chars more often than
 * trailing ones).
 */
const STAMP_PATTERNS: RegExp[] = [
	// "FIRST EDITION", "1ST EDITION", "IRST EDITION" (OCR-dropped F),
	// "FIRSTEDITION" (no space), with optional surrounding whitespace.
	/\b(?:FIRST|1ST|IRST|FIRSTED|1STED)\s*EDITION\b/gi,
	/FIRSTEDITION/gi,
	// Generic "<word> EDITION" — catches "LIMITED EDITION", "PROMO EDITION",
	// and any future <prefix> EDITION stamp without needing a code change.
	// Safe because no catalog hero name ends in EDITION.
	/\b\S+\s+EDITION\b/gi
];

export function stripCardNameStamps(s: string): string {
	if (!s) return s;
	let out = s;
	for (const re of STAMP_PATTERNS) {
		out = out.replace(re, ' ');
	}
	return out.replace(/\s+/g, ' ').trim();
}
