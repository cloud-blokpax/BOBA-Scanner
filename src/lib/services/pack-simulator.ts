/**
 * Pack Opening Simulation Engine
 *
 * Uses weighted random selection with seedrandom for reproducibility.
 * Reads pack slot configurations from Supabase (admin-managed) with
 * fallback to hardcoded defaults.
 *
 * Cards are filtered by set code so an Alpha box only pulls Alpha cards, etc.
 * Box-level guarantees (e.g., Hobby = 1 Inspired Ink, Jumbo = 3) are enforced
 * after all packs are opened by injecting guaranteed cards into eligible slots.
 *
 * Card format filtering ensures:
 * - Paper slots only pull cards with numeric-only card_number (no prefix)
 * - Battlefoil slots only pull cards with BF- prefix
 * - Bonus slots pull cards whose prefix matches the rolled parallel
 * - Featured heroes (those with Inspired Ink variants) are 5x rarer
 */

import seedrandom from 'seedrandom';
import { getAllCards } from '$lib/services/card-db';
import { getWeapon } from '$lib/data/boba-weapons';
import { getCardImageUrl } from '$lib/utils/image-url';
import { RELEASE_TO_SET_NAME } from '$lib/data/boba-config';
import {
	isPaperCardNumber,
	isBattlefoilCardNumber,
	cardMatchesParallel,
	getParallelFromCardNumber
} from '$lib/data/parallel-prefixes';
import type {
	SlotConfig,
	SlotOutcome,
	SimulatedCard,
	PackResult,
	BoxGuarantee
} from '$lib/types/pack-simulator';

// ── Featured Hero Rarity ──────────────────────────────────────

/**
 * Derive which hero names are "featured" per set.
 * A hero is featured in a set if any card with the same hero_name
 * and same set_code has an Inspired Ink autograph prefix (BFA-, BBFA-, MBFA-,
 * or any of the 71 athlete-specific auto prefixes like KGJA-, JBOA-, etc.).
 *
 * Featured heroes are ~5x rarer than non-featured in pack pulls.
 */
function buildFeaturedHeroSets(
	allCards: Array<{ hero_name?: string | null; card_number?: string | null; set_code?: string | null }>
): Map<string, Set<string>> {
	const featured = new Map<string, Set<string>>();

	for (const card of allCards) {
		if (!card.card_number || !card.hero_name || !card.set_code) continue;

		// Check if this card's prefix maps to inspired_ink or metallic_inspired_ink
		const parallel = getParallelFromCardNumber(card.card_number);
		if (parallel === 'inspired_ink' || parallel === 'metallic_inspired_ink') {
			const setKey = card.set_code.toUpperCase();
			if (!featured.has(setKey)) featured.set(setKey, new Set());
			featured.get(setKey)!.add(card.hero_name.toUpperCase().trim());
		}
	}

	return featured;
}

/** Cache so we don't rebuild every pack open */
let _featuredCache: Map<string, Set<string>> | null = null;

function getFeaturedHeroes(
	allCards: Array<{ hero_name?: string | null; card_number?: string | null; set_code?: string | null }>
): Map<string, Set<string>> {
	if (!_featuredCache) {
		_featuredCache = buildFeaturedHeroSets(allCards);
	}
	return _featuredCache;
}

/** Invalidate cache when card DB reloads */
export function invalidateFeaturedCache(): void {
	_featuredCache = null;
}

// ── Set Code Matching ─────────────────────────────────────────

/**
 * Build a set of uppercase strings that a card's set_code might match.
 * Handles both the single-letter UI code (e.g. 'G') and the display name
 * (e.g. 'Griffey Edition') so packs work regardless of what the DB stores.
 */
function buildSetMatchers(code: string): Set<string> {
	const matchers = new Set<string>();
	const upper = code.toUpperCase();
	matchers.add(upper);

	// Find the canonical display name for this code
	const displayName = RELEASE_TO_SET_NAME[code] || RELEASE_TO_SET_NAME[upper];
	if (displayName) matchers.add(displayName.toUpperCase());

	// Add ALL keys that share the same display name (cross-references A↔AE, G↔GE, etc.)
	const targetName = displayName?.toUpperCase();
	for (const [key, val] of Object.entries(RELEASE_TO_SET_NAME)) {
		const keyUpper = key.toUpperCase();
		const valUpper = val.toUpperCase();
		if (valUpper === targetName || keyUpper === upper || valUpper === upper) {
			matchers.add(keyUpper);
			matchers.add(valUpper);
		}
	}

	return matchers;
}

// ── Weapon Availability ───────────────────────────────────────

/**
 * Collect the set of weapon types that actually exist among hero cards in a pool.
 */
function getAvailableWeapons(
	cards: Array<{ weapon_type?: string | null; card_number?: string | null }>
): Set<string> {
	const weapons = new Set<string>();
	for (const c of cards) {
		if (
			c.weapon_type &&
			c.card_number &&
			!c.card_number.startsWith('PL-') &&
			!c.card_number.startsWith('BPL-') &&
			!c.card_number.startsWith('HTD')
		) {
			weapons.add(c.weapon_type.toLowerCase());
		}
	}
	return weapons;
}

/**
 * Filter a slot's outcomes to only include weapon types that exist in the set.
 * Non-weapon outcomes (parallel, card_type) are always kept.
 * If ALL weapon outcomes would be removed, they are kept as-is (defensive).
 */
function filterOutcomesBySet(
	outcomes: SlotOutcome[],
	availableWeapons: Set<string>
): SlotOutcome[] {
	const filtered = outcomes.filter(
		(o) => o.type !== 'weapon_rarity' || availableWeapons.has(o.value.toLowerCase())
	);
	// If filtering removed ALL outcomes (shouldn't happen), keep originals
	if (filtered.length === 0) return outcomes;
	return filtered;
}

// ── Card Format Inference ─────────────────────────────────────

/**
 * Infer the cardFormat from a slot's outcomes when it's missing.
 * This handles backwards-compatibility with Supabase-stored configs
 * that were saved before the cardFormat field was added.
 */
function inferCardFormat(slot: SlotConfig): 'paper' | 'battlefoil' | 'bonus' | 'any' {
	if (slot.cardFormat) return slot.cardFormat;

	// If any outcome is a card_type (play, hotdog, bonus_play), it's 'any'
	if (slot.outcomes.some(o => o.type === 'card_type')) return 'any';

	// If any outcome is a parallel type, it's a bonus/insert slot
	if (slot.outcomes.some(o => o.type === 'parallel')) return 'bonus';

	// All weapon_rarity outcomes — infer from label
	const label = slot.label.toLowerCase();
	if (label.includes('battlefoil') && !label.includes('insert') && !label.includes('parallel')) {
		return 'battlefoil';
	}

	// Default hero slots are paper
	return 'paper';
}

// ── Card Selection ────────────────────────────────────────────

type CardRecord = {
	id: string;
	weapon_type?: string | null;
	rarity?: string | null;
	parallel?: string | null;
	card_number?: string | null;
	hero_name?: string | null;
	name?: string | null;
	base_play_name?: string;
	power?: number | null;
	set_code?: string | null;
};

/**
 * Find cards in the database that match a rolled outcome,
 * filtered by the slot's cardFormat to ensure only real cards are returned.
 *
 * cardFormat filtering:
 * - 'paper':      hero cards with numeric-only card_number
 * - 'battlefoil': hero cards with BF- prefix card_number
 * - 'bonus':      hero cards matching the specific parallel's prefix
 * - 'any':        no card_number filtering (play cards, hot dogs)
 */
function findCandidates(
	setCards: CardRecord[],
	outcome: SlotOutcome,
	cardFormat: 'paper' | 'battlefoil' | 'bonus' | 'any'
): CardRecord[] {
	switch (outcome.type) {
		case 'weapon_rarity': {
			// Filter by weapon type first
			let candidates = setCards.filter(
				(c) =>
					(c.weapon_type || '').toLowerCase() === outcome.value.toLowerCase() &&
					c.card_number &&
					!c.card_number.startsWith('PL-') &&
					!c.card_number.startsWith('BPL-') &&
					!c.card_number.startsWith('HTD')
			);

			// Then filter by card format
			if (cardFormat === 'paper') {
				candidates = candidates.filter(c => isPaperCardNumber(c.card_number!));
			} else if (cardFormat === 'battlefoil') {
				candidates = candidates.filter(c => isBattlefoilCardNumber(c.card_number!));
			} else if (cardFormat === 'bonus') {
				// On a bonus slot, weapon_rarity outcomes match bonus-parallel cards
				// (any prefix that isn't paper or BF-)
				candidates = candidates.filter(c =>
					!isPaperCardNumber(c.card_number!) && !isBattlefoilCardNumber(c.card_number!)
				);
			}
			// 'any' = no additional filtering

			return candidates;
		}

		case 'parallel': {
			// Find cards whose card_number prefix matches this specific parallel
			return setCards.filter(
				(c) =>
					c.card_number &&
					!c.card_number.startsWith('PL-') &&
					!c.card_number.startsWith('BPL-') &&
					!c.card_number.startsWith('HTD') &&
					cardMatchesParallel(c.card_number, outcome.value)
			);
		}

		case 'card_type': {
			if (outcome.value === 'play') {
				return setCards.filter((c) => c.card_number?.startsWith('PL-'));
			}
			if (outcome.value === 'bonus_play') {
				return setCards.filter((c) => c.card_number?.startsWith('BPL-'));
			}
			if (outcome.value === 'hotdog') {
				return setCards.filter((c) => c.card_number?.startsWith('HTD'));
			}
			return [];
		}

		default:
			return [];
	}
}

/**
 * Select a random card from candidates, applying featured hero weighting.
 * Featured heroes (those with Inspired Ink variants in this set) are 5x less
 * likely to be selected than non-featured heroes.
 *
 * For non-hero cards (plays, hot dogs), all candidates are equally weighted.
 */
function selectWeightedCard(
	candidates: CardRecord[],
	rng: () => number,
	featuredSets: Map<string, Set<string>>
): CardRecord {
	if (candidates.length === 0) throw new Error('No candidates');
	if (candidates.length === 1) return candidates[0];

	// Check if these are hero cards (have hero_name)
	const isHeroPool = candidates.some(c => c.hero_name != null);
	if (!isHeroPool) {
		// Play cards / hot dogs: uniform random
		return candidates[Math.floor(rng() * candidates.length)];
	}

	// Build weighted list: non-featured = 1.0, featured = 0.2 (5x rarer)
	const weights: number[] = [];
	let totalWeight = 0;

	for (const card of candidates) {
		const heroName = (card.hero_name || '').toUpperCase().trim();
		const setKey = (card.set_code || '').toUpperCase();
		const setFeatured = featuredSets.get(setKey);
		const isFeatured = setFeatured?.has(heroName) ?? false;

		const w = isFeatured ? 0.2 : 1.0;
		weights.push(w);
		totalWeight += w;
	}

	// Weighted random selection
	let roll = rng() * totalWeight;
	for (let i = 0; i < candidates.length; i++) {
		roll -= weights[i];
		if (roll <= 0) return candidates[i];
	}

	return candidates[candidates.length - 1];
}

// ── Pack Opening ──────────────────────────────────────────────

/**
 * Open a simulated pack, filtering cards by set.
 */
export function openPack(
	slots: SlotConfig[],
	setCode: string,
	seed?: string
): PackResult {
	const packSeed = seed || crypto.randomUUID();
	const rng = seedrandom(packSeed);
	const allCards = getAllCards();
	// Match hero cards whose set_code matches any known form of this set code
	const matchers = buildSetMatchers(setCode);
	const setCards = allCards.filter(
		(c) => matchers.has((c.set_code || '').toUpperCase())
	);
	const cards: SimulatedCard[] = [];

	// Determine which weapon types actually exist in this set's card pool
	const availableWeapons = getAvailableWeapons(setCards);

	// Build featured hero sets ONCE per pack, not per slot
	const featuredSets = getFeaturedHeroes(allCards);

	for (const slot of slots) {
		// Filter slot outcomes to exclude weapon types not in this set
		const validOutcomes = filterOutcomesBySet(slot.outcomes, availableWeapons);
		const outcome = rollWeightedOutcome(validOutcomes, rng);
		// Play cards and hot dogs are set-agnostic — search the full card pool
		const pool = outcome.type === 'card_type' ? allCards : setCards;
		const cardFormat = inferCardFormat(slot);
		const candidates = findCandidates(pool, outcome, cardFormat);
		const card =
			candidates.length > 0
				? selectWeightedCard(candidates, rng, featuredSets)
				: null;

		if (card) {
			cards.push({
				cardId: card.id,
				heroName: card.hero_name || card.base_play_name || card.name || 'Unknown',
				cardNumber: card.card_number || '',
				power: card.power || null,
				weaponType: card.weapon_type || '',
				rarity: card.rarity || 'common',
				parallel:
					outcome.type === 'parallel'
						? outcome.value
						: cardFormat === 'battlefoil'
							? 'battlefoil'
							: cardFormat === 'paper'
								? 'paper'
								: getParallelFromCardNumber(card.card_number || '') || 'paper',
				setCode: card.set_code || '',
				slotNumber: slot.slotNumber,
				slotLabel: slot.label,
				outcomeType: outcome.type,
				outcomeValue: outcome.value,
				price: null,
				imageUrl: card.id ? getCardImageUrl({ id: card.id }) : null
			});
		} else {
			// Defensive fallback: ensure pack always has the correct card count.
			console.warn(`[pack-sim] No candidates found for slot ${slot.slotNumber} (${slot.label}), outcome: ${outcome.type}=${outcome.value}, set: ${setCode}`);
			cards.push({
				cardId: '',
				heroName: slot.label.includes('Play') ? 'Unknown Play' : slot.label.includes('Hot Dog') ? 'Hot Dog' : 'Unknown Hero',
				cardNumber: '',
				power: null,
				weaponType: '',
				rarity: 'common',
				parallel: 'base',
				setCode,
				slotNumber: slot.slotNumber,
				slotLabel: slot.label,
				outcomeType: outcome.type,
				outcomeValue: outcome.value,
				price: null,
				imageUrl: null
			});
		}
	}

	return {
		cards,
		totalValue: 0,
		bestCard: findBestCard(cards),
		seed: packSeed
	};
}

// ── Box Opening ───────────────────────────────────────────────

/**
 * Simulate opening an entire box with guarantee enforcement.
 */
export function openBox(
	slots: SlotConfig[],
	packsPerBox: number,
	setCode: string,
	guarantees: BoxGuarantee[] = [],
	boxSeed?: string
): PackResult[] {
	const seed = boxSeed || crypto.randomUUID();
	const results: PackResult[] = [];

	for (let i = 0; i < packsPerBox; i++) {
		results.push(openPack(slots, setCode, `${seed}-pack-${i}`));
	}

	// Enforce box-level guarantees
	for (const guarantee of guarantees) {
		enforceGuarantee(results, guarantee, setCode, seed);
	}

	return results;
}

/**
 * Enforce a box-level guarantee by injecting guaranteed cards
 * into random eligible slots if they didn't naturally appear.
 */
function enforceGuarantee(
	packs: PackResult[],
	guarantee: BoxGuarantee,
	setCode: string,
	boxSeed: string
): void {
	// Count how many times the guaranteed item already appeared
	let currentCount = 0;
	for (const pack of packs) {
		for (const card of pack.cards) {
			if (guarantee.type === 'parallel' && card.parallel === guarantee.value) {
				currentCount++;
			}
		}
	}

	if (currentCount >= guarantee.minCount) return;

	// Need to inject (guarantee.minCount - currentCount) more
	const needed = guarantee.minCount - currentCount;
	const rng = seedrandom(`${boxSeed}-guarantee-${guarantee.value}`);
	const matchers = buildSetMatchers(setCode);
	const allCards = getAllCards().filter(
		(c) => matchers.has((c.set_code || '').toUpperCase())
	);

	// For parallel guarantees, find cards whose card_number matches the guaranteed parallel
	const heroCandidates = allCards.filter(
		(c) =>
			c.card_number &&
			cardMatchesParallel(c.card_number, guarantee.value)
	);

	if (heroCandidates.length === 0) return;

	// Build featured sets for weighted selection
	const featuredSets = getFeaturedHeroes(getAllCards());

	// Find eligible pack slots to replace
	const eligibleReplacements: Array<{ packIdx: number; cardIdx: number }> = [];
	for (let p = 0; p < packs.length; p++) {
		for (let c = 0; c < packs[p].cards.length; c++) {
			const card = packs[p].cards[c];
			if (
				guarantee.eligibleSlots.includes(card.slotNumber) &&
				card.parallel !== guarantee.value // Don't replace an already-guaranteed card
			) {
				eligibleReplacements.push({ packIdx: p, cardIdx: c });
			}
		}
	}

	// Shuffle eligible slots and inject
	for (let i = eligibleReplacements.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[eligibleReplacements[i], eligibleReplacements[j]] = [
			eligibleReplacements[j],
			eligibleReplacements[i]
		];
	}

	for (let i = 0; i < Math.min(needed, eligibleReplacements.length); i++) {
		const { packIdx, cardIdx } = eligibleReplacements[i];
		const heroCard = selectWeightedCard(heroCandidates, rng, featuredSets);

		packs[packIdx].cards[cardIdx] = {
			cardId: heroCard.id,
			heroName: heroCard.hero_name || heroCard.name || 'Unknown',
			cardNumber: heroCard.card_number || '',
			power: heroCard.power || null,
			weaponType: heroCard.weapon_type || '',
			rarity: heroCard.rarity || 'common',
			parallel: guarantee.value,
			setCode: heroCard.set_code || '',
			slotNumber: packs[packIdx].cards[cardIdx].slotNumber,
			slotLabel: `${guarantee.value} (Guaranteed)`,
			outcomeType: 'parallel',
			outcomeValue: guarantee.value,
			price: null,
			imageUrl: heroCard.id ? getCardImageUrl({ id: heroCard.id }) : null
		};

		// Recalculate best card for this pack
		packs[packIdx].bestCard = findBestCard(packs[packIdx].cards);
	}
}

// ── Utilities ─────────────────────────────────────────────────

/**
 * Roll a weighted random outcome from a slot's outcome list.
 */
function rollWeightedOutcome(
	outcomes: SlotOutcome[],
	rng: () => number
): SlotOutcome {
	const totalWeight = outcomes.reduce((sum, o) => sum + o.weight, 0);
	let roll = rng() * totalWeight;

	for (const outcome of outcomes) {
		roll -= outcome.weight;
		if (roll <= 0) return outcome;
	}

	return outcomes[outcomes.length - 1];
}

function findBestCard(cards: SimulatedCard[]): SimulatedCard | null {
	return cards.reduce(
		(best, card) => {
			const cardWeapon = getWeapon(card.weaponType);
			const bestWeapon = best ? getWeapon(best.weaponType) : null;
			if (
				!best ||
				(cardWeapon && bestWeapon && cardWeapon.rank < bestWeapon.rank)
			) {
				return card;
			}
			// Inspired Ink beats everything except Super
			if (
				card.parallel === 'inspired_ink' &&
				best.parallel !== 'super_parallel'
			) {
				return card;
			}
			return best;
		},
		null as SimulatedCard | null
	);
}
