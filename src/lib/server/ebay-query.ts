/**
 * Canonical eBay search query builder for BoBA cards.
 *
 * Every server-side path that searches eBay for card prices MUST use this.
 * "bo jackson battle arena" is the phrase eBay sellers actually use in listings.
 */

export interface EbayQueryCard {
	hero_name?: string | null;
	name?: string | null;
	card_number?: string | null;
	athlete_name?: string | null;
}

/**
 * Build the eBay search query for a card.
 *
 * Format: "bo jackson battle arena {hero_name|name} {card_number}"
 * - athlete_name intentionally excluded: it over-narrows results and most
 *   eBay listings don't include the real athlete name in the title.
 * - "bo jackson battle arena" is the base phrase all sellers use.
 */
export function buildEbaySearchQuery(card: EbayQueryCard): string {
	const heroOrName = card.hero_name || card.name || '';
	const cardNum = card.card_number || '';
	return `bo jackson battle arena ${heroOrName} ${cardNum}`.trim();
}

/**
 * Filter eBay item summaries to those matching a specific card.
 *
 * Checks card_number (normalized for hyphens/spaces) and hero_name
 * against listing titles. Returns only items where at least one matches.
 */
export function filterRelevantListings<T extends { title?: string }>(
	items: T[],
	card: EbayQueryCard
): T[] {
	const cardNum = (card.card_number || '').toUpperCase();
	const normalizedCardNum = cardNum.replace(/[-\s]/g, '');
	const heroStr = (card.hero_name || card.name || '').toUpperCase();

	return items.filter(item => {
		if (!item.title) return false;
		const t = item.title.toUpperCase();

		if (normalizedCardNum) {
			const normalizedTitle = t.replace(/[-\s]/g, '');
			if (normalizedTitle.includes(normalizedCardNum)) return true;
		}

		if (heroStr && heroStr.length > 2 && t.includes(heroStr)) return true;

		return false;
	});
}
