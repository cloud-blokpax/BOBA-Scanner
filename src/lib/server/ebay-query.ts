/**
 * Server-side eBay search query builder and result filter for BoBA cards.
 *
 * Every server-side path that searches eBay for card prices MUST use this.
 *
 * Search priority (highest → lowest):
 *   1. Card Number — exact match (strongest unique identifier)
 *   2. Hero Name + Parallel + Weapon — exact match
 *   3. Athlete Name + Parallel + Weapon — exact match
 *   4. Fuzzy — hero or athlete name substring match
 */

import { buildEbayApiQuery } from '$lib/utils/ebay-title';
import type { EbayCardInfo } from '$lib/utils/ebay-title';

export type { EbayCardInfo as EbayQueryCard };

/**
 * Build the eBay Browse API search query for a card.
 * Includes hero, game name, athlete, and card number for broad API results.
 * Filtering is done post-fetch by filterRelevantListings().
 */
export function buildEbaySearchQuery(card: EbayCardInfo): string {
	return buildEbayApiQuery(card);
}

/**
 * Filter eBay item summaries to those matching a specific card.
 *
 * Uses a tiered priority system:
 *   Tier 1: Card number exact match (strongest signal)
 *   Tier 2: Hero name + parallel + weapon exact match
 *   Tier 3: Athlete name + parallel + weapon exact match
 *   Tier 4: Fuzzy — hero OR athlete name appears in title
 *
 * All tiers require the listing to reference BoBA ("BATTLE ARENA" or "BOBA")
 * to eliminate non-game listings.
 *
 * Returns items from the HIGHEST matching tier. If Tier 1 has matches,
 * only Tier 1 results are returned (most precise). Falls through to
 * lower tiers only if no matches found at the current tier.
 */
export function filterRelevantListings<T extends { title?: string }>(
	items: T[],
	card: EbayCardInfo
): T[] {
	const cardNum = (card.card_number || '').toUpperCase();
	const normalizedCardNum = cardNum.replace(/[-\s]/g, '');
	const heroStr = (card.hero_name || card.name || '').toUpperCase().trim();
	const athleteStr = (card.athlete_name || '').toUpperCase().trim();
	const parallelStr = (card.parallel || '').toUpperCase().trim();
	const weaponStr = (card.weapon_type || '').toUpperCase().trim();

	// Skip base/paper parallels for matching purposes
	const hasParallel = parallelStr && parallelStr !== 'PAPER' && parallelStr !== 'BASE';
	const hasWeapon = !!weaponStr;

	// Pre-filter: must reference BoBA
	const bobaItems = items.filter(item => {
		if (!item.title) return false;
		const t = item.title.toUpperCase();
		return t.includes('BATTLE ARENA') || t.includes('BOBA');
	});

	if (bobaItems.length === 0) return [];

	// ── Tier 1: Card Number exact match ──────────────────────
	if (normalizedCardNum) {
		const tier1 = bobaItems.filter(item => {
			const normalizedTitle = item.title!.toUpperCase().replace(/[-\s]/g, '');
			return normalizedTitle.includes(normalizedCardNum);
		});
		if (tier1.length > 0) return tier1;
	}

	// ── Tier 2: Hero Name + Parallel + Weapon exact match ────
	if (heroStr && heroStr.length > 2) {
		const tier2 = bobaItems.filter(item => {
			const t = item.title!.toUpperCase();
			if (!includesAllWords(t, heroStr)) return false;
			if (hasParallel && !t.includes(parallelStr)) return false;
			if (hasWeapon && !t.includes(weaponStr)) return false;
			return true;
		});
		if (tier2.length > 0) return tier2;
	}

	// ── Tier 3: Athlete Name + Parallel + Weapon exact match ─
	if (athleteStr && athleteStr.length > 2) {
		const tier3 = bobaItems.filter(item => {
			const t = item.title!.toUpperCase();
			if (!includesAllWords(t, athleteStr)) return false;
			if (hasParallel && !t.includes(parallelStr)) return false;
			if (hasWeapon && !t.includes(weaponStr)) return false;
			return true;
		});
		if (tier3.length > 0) return tier3;
	}

	// ── Tier 4: Fuzzy — hero OR athlete name substring ───────
	const tier4 = bobaItems.filter(item => {
		const t = item.title!.toUpperCase();
		if (heroStr && heroStr.length > 2 && includesAllWords(t, heroStr)) return true;
		if (athleteStr && athleteStr.length > 2 && includesAllWords(t, athleteStr)) return true;
		return false;
	});

	return tier4;
}

/**
 * Check if a title string contains all words from a name.
 * "DEANDRE HOPKINS" matches title containing both "DEANDRE" and "HOPKINS".
 */
function includesAllWords(title: string, name: string): boolean {
	const words = name.split(/\s+/).filter(w => w.length > 1);
	return words.length > 0 && words.every(w => title.includes(w));
}
