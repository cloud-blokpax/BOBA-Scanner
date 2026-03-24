/**
 * Pack Opening Simulation Engine
 *
 * Uses weighted random selection with seedrandom for reproducibility.
 * Reads pack slot configurations from Supabase (admin-managed) with
 * fallback to hardcoded defaults.
 */

import seedrandom from 'seedrandom';
import { getAllCards } from '$lib/services/card-db';
import { getWeapon } from '$lib/data/boba-weapons';
import type {
	SlotConfig,
	SlotOutcome,
	SimulatedCard,
	PackResult
} from '$lib/types/pack-simulator';

/**
 * Open a simulated pack.
 */
export function openPack(slots: SlotConfig[], seed?: string): PackResult {
	const packSeed = seed || crypto.randomUUID();
	const rng = seedrandom(packSeed);
	const allCards = getAllCards();
	const cards: SimulatedCard[] = [];

	for (const slot of slots) {
		const outcome = rollWeightedOutcome(slot.outcomes, rng);
		const candidates = findCandidates(allCards, outcome);
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
		bestCard: cards.reduce(
			(best, card) => {
				const cardWeapon = getWeapon(card.weaponType);
				const bestWeapon = best ? getWeapon(best.weaponType) : null;
				if (
					!best ||
					(cardWeapon && bestWeapon && cardWeapon.rank < bestWeapon.rank)
				) {
					return card;
				}
				return best;
			},
			null as SimulatedCard | null
		),
		seed: packSeed
	};
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
 */
function findCandidates(
	allCards: Array<{
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
): typeof allCards {
	switch (outcome.type) {
		case 'weapon_rarity':
			return allCards.filter(
				(c) =>
					(c.weapon_type || '').toLowerCase() === outcome.value.toLowerCase()
			);
		case 'parallel':
			// For parallel outcomes, pick any hero card — the parallel is the outcome
			return allCards.filter(
				(c) =>
					c.card_number &&
					!c.card_number.startsWith('PL-') &&
					!c.card_number.startsWith('BPL-') &&
					!c.card_number.startsWith('HTD')
			);
		case 'card_type':
			if (outcome.value === 'play' || outcome.value === 'bonus_play') {
				return allCards.filter(
					(c) =>
						c.card_number?.startsWith('PL-') ||
						c.card_number?.startsWith('BPL-')
				);
			}
			if (outcome.value === 'hotdog' || outcome.value === 'hotdog_foil') {
				return allCards.filter((c) => c.card_number?.startsWith('HTD'));
			}
			return [];
		default:
			return [];
	}
}

/**
 * Simulate opening an entire box (multiple packs).
 */
export function openBox(
	slots: SlotConfig[],
	packsPerBox: number,
	boxSeed?: string
): PackResult[] {
	const seed = boxSeed || crypto.randomUUID();
	const results: PackResult[] = [];
	for (let i = 0; i < packsPerBox; i++) {
		results.push(openPack(slots, `${seed}-pack-${i}`));
	}
	return results;
}
