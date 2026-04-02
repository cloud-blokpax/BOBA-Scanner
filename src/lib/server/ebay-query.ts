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

		if (normalizedCardNum) {
			const normalizedTitle = t.replace(/[-\s]/g, '');
			if (normalizedTitle.includes(normalizedCardNum)) return true;
		}

		if (heroStr && heroStr.length > 2 && t.includes(heroStr)) return true;

		if (athleteStr && athleteStr.length > 2 && t.includes(athleteStr)) return true;

		return false;
	});
}
