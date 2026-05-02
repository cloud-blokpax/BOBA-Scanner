/**
 * Phase 1 Doc 1.1 — Domain-aware vocabulary correction
 *
 * Edit-distance-1 corrections against closed-catalog vocabularies. The card
 * scanner doesn't see arbitrary text — every card_number prefix and every
 * hero name comes from a small known set. When OCR reads a single character
 * wrong (most common: confusable letter/digit pairs in small text), we can
 * repair it deterministically as long as exactly one correction is plausible.
 *
 * Used by ConsensusBuilder to widen its validation pass without sacrificing
 * the catalog cross-validation gate's strictness.
 */

import { levenshtein } from '$lib/utils/normalize-ocr-name';

/**
 * Find the unique edit-distance-1 correction of `raw` against `vocab`.
 * Returns:
 *   - `{ corrected: original, source: 'exact' }` when raw is already in vocab
 *   - `{ corrected: candidate, source: 'edit_1' }` when exactly one vocab
 *     item is at distance 1 from raw
 *   - `null` when no exact match AND zero or 2+ items at distance 1
 *
 * Distance-1 corrections are limited to substitutions, insertions, or
 * deletions of a single character. We do NOT attempt distance-2 — too many
 * false positives at the prefix scale (3-5 chars).
 */
export function correctAgainstVocab(
	raw: string,
	vocab: Iterable<string>
): { corrected: string; source: 'exact' | 'edit_1' } | null {
	if (!raw) return null;
	const upper = raw.toUpperCase();
	const items = Array.from(vocab);
	if (items.includes(upper)) {
		return { corrected: upper, source: 'exact' };
	}
	const candidates: string[] = [];
	for (const item of items) {
		// Skip vocab items whose length differs by >1; distance-1 across
		// length-2 difference is impossible.
		if (Math.abs(item.length - upper.length) > 1) continue;
		if (levenshtein(upper, item) === 1) {
			candidates.push(item);
			// Bail early — 2+ candidates means ambiguous; we'd reject anyway.
			if (candidates.length >= 2) return null;
		}
	}
	if (candidates.length === 1) {
		return { corrected: candidates[0], source: 'edit_1' };
	}
	return null;
}

/**
 * Confusable character map for OCR. Used as a hint to bias correction
 * toward the more likely repair when multiple distance-1 candidates exist.
 * Currently unused — the strict "exactly one" rule above is conservative
 * by design — but exposed here so we can flip it on with telemetry data.
 */
export const OCR_CONFUSABLE_CHARS: Record<string, string[]> = {
	'B': ['8', '3', 'R', 'P'],
	'8': ['B', '3'],
	'O': ['0', 'Q', 'C', 'D'],
	'0': ['O', 'Q', 'D'],
	'I': ['1', 'L', 'T'],
	'1': ['I', 'L', '7'],
	'L': ['1', 'I'],
	'S': ['5', '8'],
	'5': ['S', '6'],
	'Z': ['2', '7'],
	'2': ['Z', '7'],
	'G': ['6', 'C', 'O'],
	'6': ['G', '5'],
	'U': ['V', 'O'],
	'V': ['U', 'Y']
};
