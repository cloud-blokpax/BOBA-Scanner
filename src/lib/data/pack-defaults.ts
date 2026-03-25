/**
 * Default pack slot configurations for each BoBA box type.
 *
 * These are loaded as initial values when no admin-configured
 * pack configuration exists for a box type. The admin can
 * override these entirely through the Pack Simulator admin tab.
 *
 * BoBA packs contain 10 cards. The slot structure varies by box type.
 * Pull rates here are ESTIMATES based on community observation —
 * the admin should adjust these based on actual data.
 */

import type { SlotConfig } from '$lib/types/pack-simulator';

/** Blaster Box (6 packs, retail, Headliner exclusive) */
export const BLASTER_SLOTS: SlotConfig[] = [
	{
		slotNumber: 1,
		label: 'Common Hero',
		outcomes: [
			{ type: 'weapon_rarity', value: 'steel', label: 'Steel (Common)', weight: 50 },
			{ type: 'weapon_rarity', value: 'brawl', label: 'Brawl (Common)', weight: 50 }
		]
	},
	{
		slotNumber: 2,
		label: 'Common Hero',
		outcomes: [
			{ type: 'weapon_rarity', value: 'steel', label: 'Steel (Common)', weight: 50 },
			{ type: 'weapon_rarity', value: 'brawl', label: 'Brawl (Common)', weight: 50 }
		]
	},
	{
		slotNumber: 3,
		label: 'Common Hero',
		outcomes: [
			{ type: 'weapon_rarity', value: 'steel', label: 'Steel (Common)', weight: 50 },
			{ type: 'weapon_rarity', value: 'brawl', label: 'Brawl (Common)', weight: 50 }
		]
	},
	{
		slotNumber: 4,
		label: 'Common/Uncommon',
		outcomes: [
			{ type: 'weapon_rarity', value: 'steel', label: 'Steel', weight: 35 },
			{ type: 'weapon_rarity', value: 'brawl', label: 'Brawl', weight: 35 },
			{ type: 'weapon_rarity', value: 'fire', label: 'Fire (Rare)', weight: 15 },
			{ type: 'weapon_rarity', value: 'ice', label: 'Ice (Rare)', weight: 15 }
		]
	},
	{
		slotNumber: 5,
		label: 'Rare+',
		outcomes: [
			{ type: 'weapon_rarity', value: 'fire', label: 'Fire (Rare)', weight: 40 },
			{ type: 'weapon_rarity', value: 'ice', label: 'Ice (Rare)', weight: 40 },
			{ type: 'weapon_rarity', value: 'glow', label: 'Glow (Ultra Rare)', weight: 12 },
			{ type: 'weapon_rarity', value: 'hex', label: 'Hex (Secret Rare)', weight: 5 },
			{ type: 'weapon_rarity', value: 'gum', label: 'Gum (Secret Rare)', weight: 2.5 },
			{
				type: 'weapon_rarity',
				value: 'super',
				label: 'Super (Legendary 1/1)',
				weight: 0.5
			}
		]
	},
	{
		slotNumber: 6,
		label: 'Battlefoil Slot',
		outcomes: [
			{ type: 'parallel', value: 'foil', label: 'Base Foil', weight: 60 },
			{ type: 'parallel', value: 'silver', label: 'Silver Battlefoil', weight: 10 },
			{
				type: 'parallel',
				value: 'blue_battlefoil',
				label: 'Blue Battlefoil',
				weight: 10
			},
			{
				type: 'parallel',
				value: 'orange_battlefoil',
				label: 'Orange Battlefoil',
				weight: 10
			},
			{ type: 'parallel', value: 'headlines', label: 'Headlines', weight: 5 },
			{ type: 'parallel', value: 'power_glove', label: 'Power Glove', weight: 5 }
		]
	},
	{
		slotNumber: 7,
		label: 'Play Card',
		outcomes: [
			{ type: 'card_type', value: 'play', label: 'Standard Play', weight: 85 },
			{ type: 'card_type', value: 'bonus_play', label: 'Bonus Play (SP)', weight: 15 }
		]
	},
	{
		slotNumber: 8,
		label: 'Play Card',
		outcomes: [
			{ type: 'card_type', value: 'play', label: 'Standard Play', weight: 85 },
			{ type: 'card_type', value: 'bonus_play', label: 'Bonus Play (SP)', weight: 15 }
		]
	},
	{
		slotNumber: 9,
		label: 'Hot Dog',
		outcomes: [
			{ type: 'card_type', value: 'hotdog', label: 'Hot Dog', weight: 90 },
			{ type: 'card_type', value: 'hotdog_foil', label: 'Foil Hot Dog', weight: 10 }
		]
	},
	{
		slotNumber: 10,
		label: 'Headliner / Insert',
		outcomes: [
			{ type: 'parallel', value: 'foil', label: 'Base Foil', weight: 40 },
			{
				type: 'parallel',
				value: 'headlines',
				label: 'Headlines (Blaster Excl.)',
				weight: 25
			},
			{ type: 'parallel', value: 'blizzard', label: 'Blizzard', weight: 10 },
			{ type: 'parallel', value: '80s_rad', label: "80's Rad", weight: 10 },
			{
				type: 'parallel',
				value: 'grandmas_linoleum',
				label: "Grandma's Linoleum",
				weight: 8
			},
			{
				type: 'parallel',
				value: 'inspired_ink',
				label: 'Inspired Ink (Auto)',
				weight: 2
			}
		]
	}
];

/** Hobby Box (20 packs, 1 guaranteed auto, color BFs exclusive) */
export const HOBBY_SLOTS: SlotConfig[] = [
	...Array.from({ length: 4 }, (_, i) => ({
		slotNumber: i + 1,
		label: 'Common Hero',
		outcomes: [
			{
				type: 'weapon_rarity' as const,
				value: 'steel',
				label: 'Steel',
				weight: 50
			},
			{
				type: 'weapon_rarity' as const,
				value: 'brawl',
				label: 'Brawl',
				weight: 50
			}
		]
	})),
	{
		slotNumber: 5,
		label: 'Guaranteed Rare+',
		outcomes: [
			{ type: 'weapon_rarity', value: 'fire', label: 'Fire (Rare)', weight: 35 },
			{ type: 'weapon_rarity', value: 'ice', label: 'Ice (Rare)', weight: 35 },
			{
				type: 'weapon_rarity',
				value: 'glow',
				label: 'Glow (Ultra Rare)',
				weight: 15
			},
			{
				type: 'weapon_rarity',
				value: 'hex',
				label: 'Hex (Secret Rare)',
				weight: 8
			},
			{
				type: 'weapon_rarity',
				value: 'gum',
				label: 'Gum (Secret Rare)',
				weight: 5
			},
			{ type: 'weapon_rarity', value: 'super', label: 'Super (1/1)', weight: 2 }
		]
	},
	{
		slotNumber: 6,
		label: 'Color Battlefoil (Hobby Excl.)',
		outcomes: [
			{ type: 'parallel', value: 'silver', label: 'Silver', weight: 20 },
			{ type: 'parallel', value: 'blue_battlefoil', label: 'Blue', weight: 15 },
			{ type: 'parallel', value: 'orange_battlefoil', label: 'Orange', weight: 15 },
			{
				type: 'parallel',
				value: 'red_battlefoil',
				label: 'Red (Hobby Excl.)',
				weight: 10
			},
			{ type: 'parallel', value: 'green_battlefoil', label: 'Green', weight: 10 },
			{ type: 'parallel', value: 'pink_battlefoil', label: 'Pink', weight: 10 },
			{ type: 'parallel', value: 'logo', label: 'Logo', weight: 8 },
			{
				type: 'parallel',
				value: 'grillin',
				label: 'Grillin (Hobby Excl.)',
				weight: 6
			},
			{
				type: 'parallel',
				value: 'chillin',
				label: 'Chillin (Hobby Excl.)',
				weight: 6
			}
		]
	},
	{
		slotNumber: 7,
		label: 'Play Card',
		outcomes: [
			{ type: 'card_type', value: 'play', label: 'Standard Play', weight: 80 },
			{
				type: 'card_type',
				value: 'bonus_play',
				label: 'Bonus Play (SP)',
				weight: 20
			}
		]
	},
	{
		slotNumber: 8,
		label: 'Play Card',
		outcomes: [
			{ type: 'card_type', value: 'play', label: 'Standard Play', weight: 80 },
			{
				type: 'card_type',
				value: 'bonus_play',
				label: 'Bonus Play (SP)',
				weight: 20
			}
		]
	},
	{
		slotNumber: 9,
		label: 'Hot Dog',
		outcomes: [
			{ type: 'card_type', value: 'hotdog', label: 'Hot Dog', weight: 85 },
			{ type: 'card_type', value: 'hotdog_foil', label: 'Foil Hot Dog', weight: 15 }
		]
	},
	{
		slotNumber: 10,
		label: 'Insert / Auto Slot',
		outcomes: [
			{ type: 'parallel', value: 'blizzard', label: 'Blizzard', weight: 15 },
			{ type: 'parallel', value: '80s_rad', label: "80's Rad", weight: 15 },
			{
				type: 'parallel',
				value: 'grandmas_linoleum',
				label: "Grandma's Linoleum",
				weight: 12
			},
			{ type: 'parallel', value: 'mixtape', label: 'Mixtape', weight: 12 },
			{ type: 'parallel', value: 'fire_tracks', label: 'Fire Tracks', weight: 12 },
			{ type: 'parallel', value: 'bubblegum', label: 'Bubblegum', weight: 10 },
			{ type: 'parallel', value: 'slime', label: 'Slime', weight: 10 },
			{ type: 'parallel', value: 'power_glove', label: 'Power Glove', weight: 8 },
			{
				type: 'parallel',
				value: 'inspired_ink',
				label: 'Inspired Ink (Auto)',
				weight: 5
			},
			{
				type: 'parallel',
				value: 'super_parallel',
				label: 'Superfoil 1/1',
				weight: 1
			}
		]
	}
];

export const DEFAULT_CONFIGS: Record<
	string,
	{
		slots: SlotConfig[];
		packsPerBox: number;
		msrpCents: number;
		displayName: string;
	}
> = {
	blaster: {
		slots: BLASTER_SLOTS,
		packsPerBox: 6,
		msrpCents: 6995,
		displayName: 'Blaster Box'
	},
	hobby: {
		slots: HOBBY_SLOTS,
		packsPerBox: 20,
		msrpCents: 51499,
		displayName: 'Hobby Box'
	}
};
