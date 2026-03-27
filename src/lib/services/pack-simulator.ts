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
 */

import seedrandom from 'seedrandom';
import { getAllCards } from '$lib/services/card-db';
import { getWeapon } from '$lib/data/boba-weapons';
import type {
	SlotConfig,
	SlotOutcome,
	SimulatedCard,
	PackResult,
	BoxGuarantee
} from '$lib/types/pack-simulator';

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
	// Filter to only cards from the selected set
	const setCards = allCards.filter(
		(c) => (c.set_code || '').toUpperCase() === setCode.toUpperCase()
	);
	const cards: SimulatedCard[] = [];

	for (const slot of slots) {
		const outcome = rollWeightedOutcome(slot.outcomes, rng);
		const candidates = findCandidates(setCards, outcome);
		const card =
			candidates.length > 0
				? candidates[Math.floor(rng() * candidates.length)]
				: null;

		if (card) {
			cards.push({
				cardId: card.id,
				heroName: card.hero_name || card.name || 'Unknown',
				cardNumber: card.card_number || '',
				power: card.power || null,
				weaponType: card.weapon_type || '',
				rarity: card.rarity || 'common',
				parallel:
					outcome.type === 'parallel'
						? outcome.value
						: card.parallel || 'base',
				setCode: card.set_code || '',
				slotNumber: slot.slotNumber,
				slotLabel: slot.label,
				outcomeType: outcome.type,
				outcomeValue: outcome.value,
				price: null
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
	const allCards = getAllCards().filter(
		(c) => (c.set_code || '').toUpperCase() === setCode.toUpperCase()
	);
	// For parallel guarantees, pick any hero card and apply the parallel
	const heroCandidates = allCards.filter(
		(c) =>
			c.card_number &&
			!c.card_number.startsWith('PL-') &&
			!c.card_number.startsWith('BPL-') &&
			!c.card_number.startsWith('HTD')
	);

	if (heroCandidates.length === 0) return;

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
		const heroCard = heroCandidates[Math.floor(rng() * heroCandidates.length)];

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
			price: null
		};

		// Recalculate best card for this pack
		packs[packIdx].bestCard = findBestCard(packs[packIdx].cards);
	}
}

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

/**
 * Find cards in the database that match a rolled outcome.
 * Cards are pre-filtered by set before being passed to this function.
 */
function findCandidates(
	setCards: Array<{
		id: string;
		weapon_type?: string | null;
		rarity?: string | null;
		parallel?: string | null;
		card_number?: string | null;
		hero_name?: string | null;
		name?: string | null;
		power?: number | null;
		set_code?: string | null;
	}>,
	outcome: SlotOutcome
): typeof setCards {
	switch (outcome.type) {
		case 'weapon_rarity':
			// Hero cards only (exclude plays and hotdogs)
			return setCards.filter(
				(c) =>
					(c.weapon_type || '').toLowerCase() ===
						outcome.value.toLowerCase() &&
					c.card_number &&
					!c.card_number.startsWith('PL-') &&
					!c.card_number.startsWith('BPL-') &&
					!c.card_number.startsWith('HTD')
			);
		case 'parallel':
			// Any hero card — the parallel is applied as the outcome
			return setCards.filter(
				(c) =>
					c.card_number &&
					!c.card_number.startsWith('PL-') &&
					!c.card_number.startsWith('BPL-') &&
					!c.card_number.startsWith('HTD')
			);
		case 'card_type':
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
		default:
			return [];
	}
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
