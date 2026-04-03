/**
 * Pack Simulator Types
 *
 * Each pack has 10 slots. Each slot has a list of possible outcomes
 * with percentage weights. The admin configures these weights per
 * box type through the admin dashboard.
 */

/** A single possible outcome for a pack slot */
export interface SlotOutcome {
	/** What type of card this outcome produces */
	type: 'weapon_rarity' | 'parallel' | 'card_type';

	/** The specific value — e.g., 'steel', 'fire', 'blizzard', 'inspired_ink', 'play', 'hotdog' */
	value: string;

	/** Human-readable label for display in the admin UI */
	label: string;

	/** Weight as a percentage (all outcomes in a slot must sum to 100) */
	weight: number;
}

/** Configuration for a single slot in a pack */
export interface SlotConfig {
	/** Slot number (1-10) */
	slotNumber: number;

	/** Display label for this slot (e.g., "Guaranteed Rare+", "Common/Uncommon", "Insert Slot") */
	label: string;

	/**
	 * What physical card format this slot produces.
	 * 'paper'      - only cards with numeric-only card_number (no prefix)
	 * 'battlefoil' - only cards with BF- prefix card_number
	 * 'bonus'      - cards with any parallel prefix (determined by rolled outcome)
	 * 'any'        - no card_number filtering (for play cards, hot dogs)
	 */
	cardFormat: 'paper' | 'battlefoil' | 'bonus' | 'any';

	/** The possible outcomes and their weights */
	outcomes: SlotOutcome[];
}

/** Box-level guarantee (e.g., guaranteed Inspired Ink count per box) */
export interface BoxGuarantee {
	/** What must appear at least N times across all packs in the box */
	type: 'parallel';
	value: string;
	/** Minimum count across the entire box */
	minCount: number;
	/** Which slot numbers can receive the guaranteed card */
	eligibleSlots: number[];
}

/** Full configuration for a box type's pack structure */
export interface PackConfiguration {
	id: string;
	boxType: 'blaster' | 'double_mega' | 'hobby' | 'jumbo';
	/** Which set this box opens cards from */
	setCode: string;
	displayName: string;
	slots: SlotConfig[];
	packsPerBox: number;
	msrpCents: number | null;
	isActive: boolean;
	/** Box-level guarantees (e.g., guaranteed Inspired Ink count) */
	boxGuarantees: BoxGuarantee[];
}

/** A single opened card in a simulated pack */
export interface SimulatedCard {
	/** The card from the database */
	cardId: string;
	heroName: string;
	cardNumber: string;
	power: number | null;
	weaponType: string;
	rarity: string;
	parallel: string;
	setCode: string;

	/** Which slot this card came from */
	slotNumber: number;
	slotLabel: string;

	/** The outcome that was rolled for this slot */
	outcomeType: string;
	outcomeValue: string;

	/** Current Buy Now price (if available from price cache) */
	price: number | null;

	/** Reference image URL (from community scans, may not exist) */
	imageUrl: string | null;
}

/** Result of opening a single pack */
export interface PackResult {
	cards: SimulatedCard[];
	totalValue: number;
	bestCard: SimulatedCard | null;
	seed: string;
}
