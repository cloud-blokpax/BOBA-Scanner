/**
 * Default pack slot configurations for each BoBA box type.
 *
 * These are loaded as initial values when no admin-configured
 * pack configuration exists for a box type. The admin can
 * override these entirely through the Pack Simulator admin tab.
 *
 * BoBA packs contain 10 cards in a fixed order:
 *   Slots 1-6: Heroes (structure varies by box type)
 *   Slots 7-9: Play cards (always paper, never foiled)
 *   Slot 10:   Hot Dog (always paper, never foiled)
 *
 * Pull rates here are ESTIMATES based on community observation —
 * the admin should adjust these based on actual data.
 */

import type { SlotConfig, BoxGuarantee } from '$lib/types/pack-simulator';

// ── Shared slot builders ────────────────────────────────────

/** Paper hero — common weapon types only */
function paperHeroSlot(slotNumber: number): SlotConfig {
	return {
		slotNumber,
		label: 'Hero (Paper)',
		cardFormat: 'paper',
		outcomes: [
			{ type: 'weapon_rarity', value: 'steel', label: 'Steel', weight: 40 },
			{ type: 'weapon_rarity', value: 'brawl', label: 'Brawl', weight: 40 },
			{ type: 'weapon_rarity', value: 'fire', label: 'Fire', weight: 10 },
			{ type: 'weapon_rarity', value: 'ice', label: 'Ice', weight: 10 }
		]
	};
}

/** Play card slot — always paper, standard or bonus */
function playSlot(slotNumber: number): SlotConfig {
	return {
		slotNumber,
		label: 'Play (Paper)',
		cardFormat: 'any',
		outcomes: [
			{ type: 'card_type', value: 'play', label: 'Standard Play', weight: 85 },
			{ type: 'card_type', value: 'bonus_play', label: 'Bonus Play', weight: 15 }
		]
	};
}

/** Hot Dog slot — always paper, never foiled */
function hotDogSlot(slotNumber: number): SlotConfig {
	return {
		slotNumber,
		label: 'Hot Dog (Paper)',
		cardFormat: 'any',
		outcomes: [
			{ type: 'card_type', value: 'hotdog', label: 'Hot Dog', weight: 100 }
		]
	};
}

/** Battlefoil hero slot — foil treatment, any weapon up to Glow */
function battlefoilHeroSlot(slotNumber: number): SlotConfig {
	return {
		slotNumber,
		label: 'Battlefoil Hero',
		cardFormat: 'battlefoil',
		outcomes: [
			{ type: 'weapon_rarity', value: 'steel', label: 'Steel BF', weight: 30 },
			{ type: 'weapon_rarity', value: 'brawl', label: 'Brawl BF', weight: 30 },
			{ type: 'weapon_rarity', value: 'fire', label: 'Fire BF', weight: 18 },
			{ type: 'weapon_rarity', value: 'ice', label: 'Ice BF', weight: 18 },
			{ type: 'weapon_rarity', value: 'glow', label: 'Glow BF', weight: 4 }
		]
	};
}

// ── Blaster Box ─────────────────────────────────────────────

export const BLASTER_SLOTS: SlotConfig[] = [
	// Slots 1-5: Paper heroes
	paperHeroSlot(1),
	paperHeroSlot(2),
	paperHeroSlot(3),
	paperHeroSlot(4),
	paperHeroSlot(5),
	// Slot 6: Bonus parallel slot
	{
		slotNumber: 6,
		label: 'Bonus Parallel',
		cardFormat: 'bonus',
		outcomes: [
			{ type: 'parallel', value: 'orange_battlefoil', label: 'Orange BF', weight: 15 },
			{ type: 'parallel', value: 'red_headlines', label: 'Red Headlines', weight: 10 },
			{ type: 'parallel', value: 'blue_headlines', label: 'Blue Headlines', weight: 10 },
			{ type: 'parallel', value: 'orange_headlines', label: 'Orange Headlines', weight: 10 },
			{ type: 'parallel', value: 'power_glove', label: 'Power Glove', weight: 10 },
			{ type: 'weapon_rarity', value: 'fire', label: 'Fire', weight: 8 },
			{ type: 'weapon_rarity', value: 'ice', label: 'Ice', weight: 8 },
			{ type: 'weapon_rarity', value: 'glow', label: 'Glow', weight: 5 },
			{ type: 'weapon_rarity', value: 'hex', label: 'Hex', weight: 3 },
			{ type: 'weapon_rarity', value: 'gum', label: 'Gum', weight: 2.5 },
			{ type: 'weapon_rarity', value: 'super', label: 'Super 1/1', weight: 0.5 },
			{ type: 'parallel', value: 'inspired_ink', label: 'Inspired Ink', weight: 1 }
		]
	},
	// Slots 7-9: Play cards (always paper)
	playSlot(7),
	playSlot(8),
	playSlot(9),
	// Slot 10: Hot Dog (always paper, never foiled)
	hotDogSlot(10)
];

export const BLASTER_GUARANTEES: BoxGuarantee[] = [];

// ── Double Mega Box ─────────────────────────────────────────

export const DOUBLE_MEGA_SLOTS: SlotConfig[] = [
	// Slots 1-5: Paper heroes (same as Blaster)
	paperHeroSlot(1),
	paperHeroSlot(2),
	paperHeroSlot(3),
	paperHeroSlot(4),
	paperHeroSlot(5),
	// Slot 6: Bonus parallel or bonus play (unique to Double Mega)
	{
		slotNumber: 6,
		label: 'Bonus Parallel / Bonus Play',
		cardFormat: 'bonus',
		outcomes: [
			{ type: 'parallel', value: 'orange_battlefoil', label: 'Orange BF', weight: 12 },
			{ type: 'parallel', value: 'power_glove', label: 'Power Glove', weight: 8 },
			{ type: 'parallel', value: 'grandmas_linoleum', label: "Grandma's Linoleum", weight: 8 },
			{ type: 'parallel', value: 'great_grandmas_linoleum', label: "Great Grandma's Linoleum", weight: 5 },
			{ type: 'parallel', value: 'grillin', label: "Grillin'", weight: 5 },
			{ type: 'parallel', value: 'chillin', label: "Chillin'", weight: 5 },
			{ type: 'parallel', value: 'slime', label: 'Slime', weight: 5 },
			{ type: 'parallel', value: 'icon', label: 'Icon', weight: 5 },
			{ type: 'weapon_rarity', value: 'fire', label: 'Fire', weight: 7 },
			{ type: 'weapon_rarity', value: 'ice', label: 'Ice', weight: 7 },
			{ type: 'weapon_rarity', value: 'glow', label: 'Glow', weight: 4 },
			{ type: 'weapon_rarity', value: 'hex', label: 'Hex', weight: 2.5 },
			{ type: 'weapon_rarity', value: 'gum', label: 'Gum', weight: 2 },
			{ type: 'weapon_rarity', value: 'super', label: 'Super 1/1', weight: 0.5 },
			{ type: 'parallel', value: 'inspired_ink', label: 'Inspired Ink', weight: 1 },
			{ type: 'card_type', value: 'bonus_play', label: 'Bonus Play (DM Excl.)', weight: 15 }
		]
	},
	// Slots 7-9: Play cards (always paper)
	playSlot(7),
	playSlot(8),
	playSlot(9),
	// Slot 10: Hot Dog (always paper)
	hotDogSlot(10)
];

export const DOUBLE_MEGA_GUARANTEES: BoxGuarantee[] = [];

// ── Hobby Box ───────────────────────────────────────────────

export const HOBBY_SLOTS: SlotConfig[] = [
	// Slots 1-3: Paper heroes
	paperHeroSlot(1),
	paperHeroSlot(2),
	paperHeroSlot(3),
	// Slots 4-5: Always Battlefoil (up to Glow — no Hex/Gum/Super)
	battlefoilHeroSlot(4),
	battlefoilHeroSlot(5),
	// Slot 6: Any parallel (full range including Inspired Ink, Super)
	{
		slotNumber: 6,
		label: 'Insert / Parallel Hero',
		cardFormat: 'bonus',
		outcomes: [
			{ type: 'parallel', value: 'silver', label: 'Silver BF', weight: 8 },
			{
				type: 'parallel',
				value: 'blue_battlefoil',
				label: 'Blue BF',
				weight: 8
			},
			{
				type: 'parallel',
				value: 'orange_battlefoil',
				label: 'Orange BF',
				weight: 8
			},
			{
				type: 'parallel',
				value: 'red_battlefoil',
				label: 'Red BF (Hobby Excl.)',
				weight: 5
			},
			{
				type: 'parallel',
				value: 'green_battlefoil',
				label: 'Green BF',
				weight: 5
			},
			{
				type: 'parallel',
				value: 'pink_battlefoil',
				label: 'Pink BF',
				weight: 5
			},
			{ type: 'parallel', value: 'blizzard', label: 'Blizzard', weight: 6 },
			{ type: 'parallel', value: '80s_rad', label: "80's Rad", weight: 6 },
			{
				type: 'parallel',
				value: 'grandmas_linoleum',
				label: "Grandma's Linoleum",
				weight: 5
			},
			{ type: 'parallel', value: 'headlines', label: 'Headlines', weight: 5 },
			{ type: 'parallel', value: 'logo', label: 'Logo', weight: 4 },
			{ type: 'parallel', value: 'mixtape', label: 'Mixtape', weight: 5 },
			{
				type: 'parallel',
				value: 'fire_tracks',
				label: 'Fire Tracks',
				weight: 5
			},
			{ type: 'parallel', value: 'bubblegum', label: 'Bubblegum', weight: 5 },
			{
				type: 'parallel',
				value: 'grillin',
				label: 'Grillin (Hobby Excl.)',
				weight: 3
			},
			{
				type: 'parallel',
				value: 'chillin',
				label: 'Chillin (Hobby Excl.)',
				weight: 3
			},
			{ type: 'parallel', value: 'slime', label: 'Slime', weight: 4 },
			{
				type: 'parallel',
				value: 'power_glove',
				label: 'Power Glove',
				weight: 4
			},
			{
				type: 'parallel',
				value: 'inspired_ink',
				label: 'Inspired Ink (Auto)',
				weight: 3
			},
			{ type: 'weapon_rarity', value: 'hex', label: 'Hex Hero', weight: 3 },
			{ type: 'weapon_rarity', value: 'gum', label: 'Gum Hero', weight: 2 },
			{
				type: 'weapon_rarity',
				value: 'super',
				label: 'Super 1/1',
				weight: 0.5
			},
			{
				type: 'parallel',
				value: 'super_parallel',
				label: 'Superfoil Parallel',
				weight: 0.5
			}
		]
	},
	// Slots 7-9: Play cards (always paper)
	playSlot(7),
	playSlot(8),
	playSlot(9),
	// Slot 10: Hot Dog (always paper)
	hotDogSlot(10)
];

export const HOBBY_GUARANTEES: BoxGuarantee[] = [
	{ type: 'parallel', value: 'inspired_ink', minCount: 1, eligibleSlots: [6] }
];

// ── Jumbo Hobby Box ─────────────────────────────────────────

// Same pack structure as Hobby
export const JUMBO_SLOTS: SlotConfig[] = HOBBY_SLOTS;

export const JUMBO_GUARANTEES: BoxGuarantee[] = [
	{ type: 'parallel', value: 'inspired_ink', minCount: 3, eligibleSlots: [6] }
];

// ── Default Configurations ──────────────────────────────────

export interface BoxTypeConfig {
	slots: SlotConfig[];
	packsPerBox: number;
	msrpCents: number;
	displayName: string;
	guarantees: BoxGuarantee[];
	/** Which sets this box type is available for */
	availableForSets: string[];
}

export const DEFAULT_CONFIGS: Record<string, BoxTypeConfig> = {
	blaster: {
		slots: BLASTER_SLOTS,
		packsPerBox: 6,
		msrpCents: 6995,
		displayName: 'Blaster Box',
		guarantees: BLASTER_GUARANTEES,
		availableForSets: ['A', 'U', 'G', 'T']
	},
	double_mega: {
		slots: DOUBLE_MEGA_SLOTS,
		packsPerBox: 14,
		msrpCents: 12599,
		displayName: 'Double Mega Box',
		guarantees: DOUBLE_MEGA_GUARANTEES,
		availableForSets: ['G', 'T'] // NOT available for Alpha or Update
	},
	hobby: {
		slots: HOBBY_SLOTS,
		packsPerBox: 20,
		msrpCents: 51499,
		displayName: 'Hobby Box',
		guarantees: HOBBY_GUARANTEES,
		availableForSets: ['A', 'U', 'G', 'T']
	},
	jumbo: {
		slots: JUMBO_SLOTS,
		packsPerBox: 50,
		msrpCents: 99999,
		displayName: 'Jumbo Hobby Box',
		guarantees: JUMBO_GUARANTEES,
		availableForSets: ['A', 'U', 'G', 'T']
	}
};

/** Set-specific overrides (e.g., Tecmo Double Mega has 16 packs not 14) */
export const SET_OVERRIDES: Record<string, Record<string, Partial<BoxTypeConfig>>> = {
	T: {
		double_mega: { packsPerBox: 16 }
	}
};

/** Get config for a specific box type + set, applying set overrides */
export function getBoxConfig(boxType: string, setCode: string): BoxTypeConfig | null {
	const base = DEFAULT_CONFIGS[boxType];
	if (!base) return null;
	if (!base.availableForSets.includes(setCode)) return null;

	const override = SET_OVERRIDES[setCode]?.[boxType];
	if (override) {
		return { ...base, ...override };
	}
	return base;
}
