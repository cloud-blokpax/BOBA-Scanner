/**
 * Deck Gap Finder Service
 *
 * Analyzes an in-progress deck against tournament format rules to find
 * cards that would legally fill remaining slots. Filters out cards the
 * user already owns and sorts by cheapest price first.
 *
 * Used by both the inline deck builder "Shop" tab and the standalone
 * /deck/shop page.
 */

import { getAllCards } from '$lib/services/card-db';
import { getFormat } from '$lib/data/tournament-formats';
import { getWeaponRank } from '$lib/data/boba-weapons';
import { getParallelRarity } from '$lib/services/parallel-config';
import type { Card, CardRarity } from '$lib/types';

// ── Types ───────────────────────────────────────────────────

export interface DeckGap {
	/** Power level where the deck needs more cards */
	powerLevel: number;
	/** How many cards at this power level the deck currently has */
	currentCount: number;
	/** Maximum allowed at this power level for the format */
	maxAllowed: number;
	/** How many more cards the deck could accept at this level */
	slotsAvailable: number;
}

export interface GapCandidate {
	card: Card;
	/** Which gap this card fills */
	powerLevel: number;
	slotsAvailable: number;
	/** Price data from cache (null = never searched, undefined = searched but no results) */
	priceMid: number | null;
	priceLastUpdated: string | null;
	/** Whether this card has ever been price-checked */
	priceSearched: boolean;
	/** eBay affiliate search URL */
	ebayUrl: string;
	/** Commonality score: lower = more common = cheaper to acquire */
	commonalityScore: number;
	/** Parallel rarity for display */
	parallelRarity: CardRarity;
	/** Weapon rarity rank (1=legendary, 8=common) */
	weaponRank: number;
}

export interface GapAnalysis {
	formatId: string;
	formatName: string;
	/** Total cards needed to reach minimum deck size */
	cardsNeeded: number;
	/** Power levels with available slots */
	gaps: DeckGap[];
	/** Cards that could fill the gaps, sorted by price (cheapest first) */
	candidates: GapCandidate[];
	/** Total unique candidates found */
	totalCandidates: number;
}

// ── Rarity weight for commonality scoring ───────────────────
// Lower score = more common = easier/cheaper to acquire
const RARITY_WEIGHT: Record<CardRarity, number> = {
	common: 1,
	uncommon: 2,
	rare: 4,
	ultra_rare: 8,
	legendary: 16
};

/**
 * Analyze deck gaps and find candidate cards to fill them.
 *
 * @param currentHeroCards - Cards already in the deck
 * @param formatId - Tournament format ID
 * @param ownedCardIds - Set of card IDs the user owns (excluded from results)
 * @param priceCache - Map of card_id → { price_mid, fetched_at } from the price cache
 * @param limit - Maximum candidates to return (default 200 for the full page)
 */
export function analyzeDeckGaps(
	currentHeroCards: Card[],
	formatId: string,
	ownedCardIds: Set<string>,
	priceCache: Map<string, { price_mid: number | null; fetched_at: string | null }>,
	limit = 200
): GapAnalysis | null {
	const format = getFormat(formatId);
	if (!format) return null;

	// ── Step 1: Compute current deck state ──────────────────
	const currentPowerCounts: Record<number, number> = {};
	const currentCardIds = new Set(currentHeroCards.map(c => c.id));

	for (const card of currentHeroCards) {
		const p = card.power || 0;
		currentPowerCounts[p] = (currentPowerCounts[p] || 0) + 1;
	}

	// ── Step 2: Find gaps — power levels with available slots ─
	const gaps: DeckGap[] = [];
	const cardsNeeded = Math.max(0, format.heroDeckMin - currentHeroCards.length);
	const allCards = getAllCards();

	// Collect distinct power levels from the actual card database
	// instead of iterating fixed increments (which misses non-standard values)
	const allPowerLevels = new Set<number>();
	for (const c of allCards) {
		if (c.power && c.power > 0) allPowerLevels.add(c.power);
	}

	for (const power of allPowerLevels) {
		// Skip powers above format caps
		if (format.specPowerCap && power > format.specPowerCap) continue;
		if (format.absoluteMaxPower && power > format.absoluteMaxPower) continue;
		// Get the max allowed at this power level
		let maxAtLevel = format.maxPerPowerLevel;

		// SPEC+ has graduated power slot limits
		if (format.powerSlotLimits) {
			const slotLimit = format.powerSlotLimits[power];
			if (slotLimit !== undefined) {
				maxAtLevel = slotLimit;
			}
		}

		const currentAtLevel = currentPowerCounts[power] || 0;
		const slotsAvailable = maxAtLevel - currentAtLevel;

		if (slotsAvailable > 0) {
			gaps.push({
				powerLevel: power,
				currentCount: currentAtLevel,
				maxAllowed: maxAtLevel,
				slotsAvailable
			});
		}
	}

	// ── Step 3: Find candidate cards from the full database ──
	const candidateMap = new Map<string, GapCandidate>();

	// Build a set of gap power levels for fast lookup
	const gapPowerSet = new Map<number, DeckGap>();
	for (const gap of gaps) {
		gapPowerSet.set(gap.powerLevel, gap);
	}

	for (const card of allCards) {
		// Skip cards already in the deck
		if (currentCardIds.has(card.id)) continue;

		// Skip cards the user already owns
		if (ownedCardIds.has(card.id)) continue;

		// Skip cards with no power (play cards, hot dogs, etc.)
		if (!card.power) continue;

		// Skip cards above the format's power cap
		if (format.specPowerCap && card.power > format.specPowerCap) continue;
		if (format.absoluteMaxPower && card.power > format.absoluteMaxPower) continue;

		// Skip if this power level has no available slots
		const gap = gapPowerSet.get(card.power);
		if (!gap) continue;

		// Skip if format restricts parallels and this card doesn't match
		if (format.allowedParallels && format.allowedParallels.length > 0) {
			const cardParallel = (card.parallel || 'base').toLowerCase();
			const isAllowed = format.allowedParallels.some(
				p => cardParallel.includes(p.toLowerCase())
			);
			if (!isAllowed) continue;
		}

		// Compute commonality score (lower = more common = easier to find)
		const parallelRarity = getParallelRarity(card.parallel);
		const weaponRank = getWeaponRank(card.weapon_type || 'steel');
		const commonalityScore =
			RARITY_WEIGHT[parallelRarity] * weaponRank;

		// Look up cached price
		const cached = priceCache.get(card.id);
		const priceMid = cached?.price_mid ?? null;
		const priceLastUpdated = cached?.fetched_at ?? null;
		const priceSearched = cached !== undefined;

		// Build eBay affiliate URL
		const ebayUrl = buildEbayUrlForCard(card);

		candidateMap.set(card.id, {
			card,
			powerLevel: card.power,
			slotsAvailable: gap.slotsAvailable,
			priceMid,
			priceLastUpdated,
			priceSearched,
			ebayUrl,
			commonalityScore,
			parallelRarity,
			weaponRank
		});
	}

	// ── Step 4: Sort candidates ─────────────────────────────
	// Priority: cheapest price first, then unsearched, then no-results
	const candidates = [...candidateMap.values()].sort((a, b) => {
		// Group 1: Has a price (cheapest first)
		if (a.priceMid !== null && b.priceMid !== null) {
			return a.priceMid - b.priceMid;
		}
		// Cards with prices come before cards without
		if (a.priceMid !== null) return -1;
		if (b.priceMid !== null) return 1;

		// Group 2: Never searched (might have a price, we just don't know yet)
		if (!a.priceSearched && b.priceSearched) return -1;
		if (a.priceSearched && !b.priceSearched) return 1;

		// Group 3: Searched but no results — sort by commonality (most common first)
		return a.commonalityScore - b.commonalityScore;
	});

	return {
		formatId,
		formatName: format.name,
		cardsNeeded,
		gaps,
		candidates: candidates.slice(0, limit),
		totalCandidates: candidates.length
	};
}

/**
 * Select the 10 best cards to refresh prices for.
 * Prioritizes: not in deck, not owned, most common parallel, most common weapon.
 * Returns unique cards (no duplicate heroes at the same power level).
 */
export function selectCardsForPriceRefresh(
	candidates: GapCandidate[],
	count = 10
): GapCandidate[] {
	// Filter to candidates that either haven't been searched or have stale prices (>24h)
	const needsRefresh = candidates.filter(c => {
		if (!c.priceSearched) return true;
		if (!c.priceLastUpdated) return true;
		const age = Date.now() - new Date(c.priceLastUpdated).getTime();
		return age > 24 * 60 * 60 * 1000; // Older than 24 hours
	});

	// Sort by commonality (most common first — these are most likely to have eBay listings)
	const sorted = [...needsRefresh].sort((a, b) => a.commonalityScore - b.commonalityScore);

	// Deduplicate by hero name + power level (don't refresh 5 variants of the same hero)
	const seen = new Set<string>();
	const selected: GapCandidate[] = [];

	for (const candidate of sorted) {
		const key = `${candidate.card.hero_name || candidate.card.name}|${candidate.powerLevel}`;
		if (seen.has(key)) continue;
		seen.add(key);
		selected.push(candidate);
		if (selected.length >= count) break;
	}

	return selected;
}

// ── Helper: build eBay URL ──────────────────────────────────
function buildEbayUrlForCard(card: Card): string {
	const parts = ['BoBA', 'Battle Arena'];
	if (card.hero_name) parts.push(card.hero_name);
	if (card.card_number) parts.push(card.card_number);
	const query = parts.join(' ');
	const params = new URLSearchParams({
		_nkw: query,
		mkevt: '1',
		mkcid: '1',
		mkrid: '711-53200-19255-0',
		campid: '5339108029',
		toolid: '10001'
	});
	return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}
