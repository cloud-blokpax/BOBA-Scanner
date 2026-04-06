/**
 * Server-side eBay search query builder and result filter for BoBA cards.
 *
 * Every server-side path that searches eBay for card prices MUST use this.
 */

import { buildEbayApiQuery } from '$lib/utils/ebay-title';
import type { EbayCardInfo } from '$lib/utils/ebay-title';

export type { EbayCardInfo as EbayQueryCard };

/**
 * Build the eBay Browse API search query for a card.
 *
 * Format: Hero Name - Bo Jackson Battle Arena - Athlete Name - Card Number
 * (weapon and parallel dropped for broader API search results)
 */
export function buildEbaySearchQuery(card: EbayCardInfo): string {
	return buildEbayApiQuery(card);
}

/**
 * Filter eBay item summaries to those matching a specific card.
 *
 * Checks card_number, hero_name, and athlete_name against listing titles.
 * Returns only items where at least one identifier matches.
 */
export function filterRelevantListings<T extends { title?: string }>(
	items: T[],
	card: EbayCardInfo
): T[] {
	const cardNum = (card.card_number || '').toUpperCase();
	const normalizedCardNum = cardNum.replace(/[-\s]/g, '');
	const heroStr = (card.hero_name || card.name || '').toUpperCase();
	const athleteStr = (card.athlete_name || '').toUpperCase();

	return items.filter(item => {
		if (!item.title) return false;
		const t = item.title.toUpperCase();

		// Gate 1: Must reference BoBA — eliminates all non-game listings
		// that eBay returns via "results matching fewer words"
		if (!t.includes('BATTLE ARENA') && !t.includes('BOBA')) return false;

		// Gate 2: If the card has a card_number, the listing MUST contain it.
		// Card numbers like SF-4, BF-120, 42 are the strongest unique identifier.
		// Without this, a search for "Boz SF-4" would match "Boz 42" (wrong card).
		if (normalizedCardNum) {
			const normalizedTitle = t.replace(/[-\s]/g, '');
			return normalizedTitle.includes(normalizedCardNum);
		}

		// No card_number on the card record — fall back to name matching.
		// Require hero OR athlete name to appear in the title.
		if (heroStr && heroStr.length > 2 && t.includes(heroStr)) return true;
		if (athleteStr && athleteStr.length > 2 && t.includes(athleteStr)) return true;

		return false;
	});
}
