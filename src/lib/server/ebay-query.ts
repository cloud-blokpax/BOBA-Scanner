/**
 * Server-side eBay search query builder and result filter for BoBA cards.
 *
 * Every server-side path that searches eBay for card prices MUST use this.
 *
 * Search priority (highest → lowest):
 *   1. Hero Name + Parallel (most common path)
 *   2. Athlete Name + Parallel
 *   3. Card Number prefix (inherently parallel-specific)
 *   4. Broad hero/athlete match with parallel gate
 */

import { buildEbayApiQuery } from '$lib/utils/ebay-title';
import type { EbayCardInfo } from '$lib/utils/ebay-title';

export type { EbayCardInfo as EbayQueryCard };

/**
 * Build the eBay Browse API search query for a card.
 * Includes hero, game name, parallel, and athlete for targeted API results.
 * Filtering is done post-fetch by filterRelevantListings().
 */
export function buildEbaySearchQuery(card: EbayCardInfo): string {
	return buildEbayApiQuery(card);
}

/**
 * Filter eBay item summaries to those matching a specific card.
 *
 * KEY PRINCIPLE: When the card has a known parallel (non-paper/base),
 * every tier enforces parallel matching. This prevents mixing a $3
 * Orange Battlefoil with a $200 Gum Battlefoil.
 *
 * Tier priority (returns first tier with results):
 *   Tier 1: Hero name + parallel match (most common successful path)
 *   Tier 2: Athlete name + parallel match
 *   Tier 3: Card number prefix match (parallel inherently encoded in prefix)
 *   Tier 4: Hero OR athlete name — STILL requires parallel when known
 *
 * All tiers require the listing to reference BoBA ("BATTLE ARENA" or "BOBA").
 * Weapon is never required — it's too inconsistent in seller listings.
 */
export function filterRelevantListings<T extends { title?: string }>(
	items: T[],
	card: EbayCardInfo
): T[] {
	const heroStr = (card.hero_name || card.name || '').toUpperCase().trim();
	const athleteStr = (card.athlete_name || '').toUpperCase().trim();
	const parallelStr = (card.parallel || '').toUpperCase().trim();
	const cardNum = (card.card_number || '').toUpperCase();
	const normalizedCardNum = cardNum.replace(/[-\s]/g, '');

	// Skip base/paper parallels for matching purposes
	const hasParallel = parallelStr && parallelStr !== 'PAPER' && parallelStr !== 'BASE';

	// Pre-filter: must reference BoBA
	const bobaItems = items.filter(item => {
		if (!item.title) return false;
		const t = item.title.toUpperCase();
		return t.includes('BATTLE ARENA') || t.includes('BOBA');
	});

	if (bobaItems.length === 0) return [];

	// Helper: check if listing matches the parallel
	const matchesParallel = (title: string): boolean => {
		if (!hasParallel) return true; // No parallel to check = everything passes
		return title.includes(parallelStr);
	};

	// ── Tier 1: Hero Name + Parallel ─────────────────────────
	// Most common path. Sellers almost always include hero name + parallel.
	if (heroStr && heroStr.length > 2) {
		const tier1 = bobaItems.filter(item => {
			const t = item.title!.toUpperCase();
			return includesAllWords(t, heroStr) && matchesParallel(t);
		});
		if (tier1.length > 0) return tier1;
	}

	// ── Tier 2: Athlete Name + Parallel ──────────────────────
	// Some sellers use athlete name instead of hero name.
	if (athleteStr && athleteStr.length > 2) {
		const tier2 = bobaItems.filter(item => {
			const t = item.title!.toUpperCase();
			return includesAllWords(t, athleteStr) && matchesParallel(t);
		});
		if (tier2.length > 0) return tier2;
	}

	// ── Tier 3: Card Number prefix match ─────────────────────
	// Card number includes the parallel prefix (e.g., OBF-20 = Orange Battlefoil).
	// So a card number match is inherently parallel-specific.
	if (normalizedCardNum && normalizedCardNum.length > 2) {
		const tier3 = bobaItems.filter(item => {
			const normalizedTitle = item.title!.toUpperCase().replace(/[-\s]/g, '');
			return normalizedTitle.includes(normalizedCardNum);
		});
		if (tier3.length > 0) return tier3;
	}

	// ── Tier 4: Broad hero/athlete match WITH parallel gate ──
	// Fallback, but STILL requires parallel match when parallel is known.
	// This is the critical difference from the old code, which had NO
	// parallel check here and let all parallels through.
	const tier4 = bobaItems.filter(item => {
		const t = item.title!.toUpperCase();
		if (!matchesParallel(t)) return false; // Enforce parallel even in fallback
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
