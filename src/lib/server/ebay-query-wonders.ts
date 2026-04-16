/**
 * Server-side eBay search query builder + result filter for Wonders of The First.
 *
 * Tuned for the Wonders ecosystem: card name + set display + variant long-form
 * name + collector number. Uses quoted phrases to force eBay to match exact
 * strings, producing cleaner results than loose keyword search.
 *
 * The BoBA equivalent lives in ebay-query.ts — this file is the Wonders-only
 * parallel path, dispatched by game_id in the harvester.
 */

import type { EbayCardInfo } from '$lib/utils/ebay-title';

// ── Variant → eBay search keyword mapping ────────────────────
// Paper gets no keyword (base search). Foils get long-form names plus
// alternative phrasings that real sellers use.
const VARIANT_KEYWORDS: Record<string, string[]> = {
	paper: [],
	cf: ['"Classic Foil"'],
	ff: ['"Formless Foil"', '"Borderless"'],
	ocm: ['"Orbital Color Match"', '"OCM"'],
	sf: ['"Stone Foil"', '"1/1"'],
};

// ── Common game names + rejection patterns ───────────────────
const WONDERS_TITLE_TOKENS = ['WONDERS OF THE FIRST', 'WOTF'] as const;
const BOBA_CONTAMINATION_TOKENS = ['BO JACKSON', 'BATTLE ARENA', 'BOBA'] as const;
const BULK_REJECT_TOKENS = ['LOT', 'COLLECTION', 'BULK', 'MIXED', 'RANDOM', 'BUNDLE'] as const;

/**
 * Build a quoted eBay query for a Wonders card.
 * Example:
 *   `"Bellator" "Wonders of The First" "Call of the Stones" "Classic Foil" "78/402"`
 *
 * Quoting forces exact-phrase matching. Sparse metadata (missing set display
 * or variant) gracefully drops those phrases — the query still anchors on
 * the card name and game name at minimum.
 */
export function buildWondersEbayQuery(card: EbayCardInfo): string {
	const parts: string[] = [];

	const cardName = (card.name || card.hero_name || '').trim();
	if (cardName) parts.push(`"${cardName}"`);

	// Always anchor on the game name
	parts.push('"Wonders of The First"');

	const setDisplay = wondersSetDisplay(card.metadata);
	if (setDisplay) parts.push(`"${setDisplay}"`);

	const variant = (card.variant || 'paper').toLowerCase();
	const variantKeywords = VARIANT_KEYWORDS[variant] || [];
	if (variantKeywords.length > 0) {
		// Use the first alternative; filter accepts all alternatives during post-filtering.
		parts.push(variantKeywords[0]);
	}

	const cardNum = (card.card_number || '').trim();
	if (cardNum) parts.push(`"${cardNum}"`);

	return parts.join(' ');
}

/**
 * Filter eBay item summaries to those matching a specific Wonders card+variant.
 *
 * Rules (all required):
 *   - Title references Wonders ("Wonders of The First" OR "WoTF")
 *   - Title does NOT contain BoBA tokens (prevents cross-game contamination)
 *   - Title does NOT suggest a multi-card lot (prevents bulk-price false positives)
 *   - Title contains the card name OR the collector number
 *   - For foil variants, title contains at least one of that variant's keywords
 */
export function filterRelevantWondersListings<T extends { title?: string }>(
	items: T[],
	card: EbayCardInfo
): T[] {
	const cardName = (card.name || card.hero_name || '').toUpperCase().trim();
	const cardNum = (card.card_number || '').toUpperCase().trim();
	const variant = (card.variant || 'paper').toLowerCase();
	const variantKeywords = VARIANT_KEYWORDS[variant] || [];

	return items.filter((item) => {
		if (!item.title) return false;
		const t = item.title.toUpperCase();

		// Must reference Wonders
		if (!WONDERS_TITLE_TOKENS.some((tok) => t.includes(tok))) return false;

		// Reject BoBA-contaminated listings (mixed-game lots)
		if (BOBA_CONTAMINATION_TOKENS.some((tok) => t.includes(tok))) return false;

		// Reject multi-card lots (the price represents N cards, not 1)
		if (BULK_REJECT_TOKENS.some((tok) => new RegExp(`\\b${tok}\\b`).test(t))) return false;

		// Card identity: name OR collector number must match
		const matchesName = cardName.length > 2 && includesAllWords(t, cardName);
		const matchesNumber = cardNum.length > 2 && t.replace(/[-\s]/g, '').includes(cardNum.replace(/[-\s]/g, ''));
		if (!matchesName && !matchesNumber) return false;

		// Variant gate: foils must show at least one matching keyword phrase.
		// Paper has no keyword requirement.
		if (variantKeywords.length > 0) {
			// Strip quotes for substring matching (eBay titles don't preserve them)
			const keywordPhrases = variantKeywords.map((k) => k.replace(/"/g, '').toUpperCase());
			if (!keywordPhrases.some((kw) => t.includes(kw))) return false;
		}

		return true;
	});
}

/**
 * Confidence scoring for Wonders listings.
 *
 * Rewards: matches on BOTH card name AND (collector number OR set name).
 * Penalizes: matches on card name alone (the same name can exist across printings).
 *
 * Returns a score in [0, 1]. Caller is responsible for comparing against a
 * threshold and for aggregating scores across a result set.
 */
export function scoreWondersListingMatch(title: string, card: EbayCardInfo): number {
	const t = title.toUpperCase();
	const cardName = (card.name || card.hero_name || '').toUpperCase().trim();
	const cardNum = (card.card_number || '').toUpperCase().trim();
	const setDisplay = wondersSetDisplay(card.metadata).toUpperCase();

	const hasName = cardName.length > 2 && includesAllWords(t, cardName);
	const hasNumber = cardNum.length > 2 && t.replace(/[-\s]/g, '').includes(cardNum.replace(/[-\s]/g, ''));
	const hasSet = setDisplay.length > 3 && t.includes(setDisplay);
	const hasStrongContext = hasNumber || hasSet;

	if (hasName && hasStrongContext) return 1.0;       // Strongly confident
	if (hasName && !hasStrongContext) return 0.55;     // Name-only is ambiguous — half credit
	if (hasNumber) return 0.75;                        // Number alone is a good signal
	return 0.0;
}

// ── Helpers ──────────────────────────────────────────────────

function wondersSetDisplay(metadata: Record<string, unknown> | null | undefined): string {
	if (!metadata) return '';
	const raw = metadata.set_name_display ?? metadata.set_name;
	return typeof raw === 'string' ? raw.trim() : '';
}

function includesAllWords(title: string, name: string): boolean {
	const words = name.split(/\s+/).filter((w) => w.length > 1);
	return words.length > 0 && words.every((w) => title.includes(w));
}
