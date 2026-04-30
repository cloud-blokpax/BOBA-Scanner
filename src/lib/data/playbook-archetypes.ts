/**
 * Playbook Archetype Definitions
 *
 * Each archetype is a complete strategic framework defining:
 * - Which play categories to prioritize
 * - Which combo engines to target
 * - Recommended category slot allocations
 * - Hero weapon composition guidance
 */

export interface PlaybookArchetype {
	id: string;
	name: string;
	tagline: string;
	description: string;
	/** Which combo engines this archetype uses (references combo-engines.ts IDs) */
	comboEngines: string[];
	/** Category allocation: how many of the 30 slots to dedicate to each category */
	categoryAllocation: Record<string, { min: number; max: number; priority: number }>;
	/** Recommended hero weapon distribution */
	heroRecommendation: {
		primaryWeapon: string | null;
		primaryCount: number;
		reasoning: string;
	};
	/** Projected game metrics */
	projectedMetrics: {
		hdEndOfGame: number;
		playsActivated: number;
		subsNeeded: number;
	};
	/** Which tournament formats this archetype works best in */
	bestFormats: string[];
	/** Difficulty for new players */
	difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export const PLAYBOOK_ARCHETYPES: PlaybookArchetype[] = [
	{
		id: 'mono_steel_fortress',
		name: 'Steel Fortress',
		tagline: 'Consistent, defensive, and hard to break',
		description:
			'Heavy Steel heroes with the full Steel play package. Steel Defense shuts down opponents at critical moments. Steel-specific buffs stack permanently. Minimal substitution needed due to weapon consistency.',
		comboEngines: ['weapon_alchemy', 'recovery_snowball'],
		categoryAllocation: {
			weapon_steel: { min: 8, max: 13, priority: 1 },
			hd_recovery: { min: 3, max: 5, priority: 2 },
			draw_play: { min: 4, max: 6, priority: 3 },
			power_boost: { min: 4, max: 8, priority: 4 },
			sub_denial: { min: 1, max: 2, priority: 5 },
			persistent: { min: 2, max: 3, priority: 6 }
		},
		heroRecommendation: {
			primaryWeapon: 'steel',
			primaryCount: 45,
			reasoning:
				'At 45/60 Steel, your Steel-specific plays fire in 5.2 of 7 battles. Substitution for weapon matching is almost never needed.'
		},
		projectedMetrics: { hdEndOfGame: 2, playsActivated: 7, subsNeeded: 0.5 },
		bestFormats: ['spec_playmaker', 'spec_plus'],
		difficulty: 'beginner'
	},
	{
		id: 'mono_fire_rush',
		name: 'Fire Rush',
		tagline: 'Stack permanent buffs, overwhelm late',
		description:
			'Fire Boost + Eternal Flame + Baby Phoenix create a compounding power advantage that grows every battle. Scorching Pressure adds passive opponent damage. Fire plays are slightly more DBS-efficient than Steel.',
		comboEngines: ['recovery_snowball'],
		categoryAllocation: {
			weapon_fire: { min: 7, max: 11, priority: 1 },
			persistent: { min: 3, max: 5, priority: 2 },
			hd_recovery: { min: 3, max: 5, priority: 3 },
			draw_play: { min: 4, max: 6, priority: 4 },
			power_boost: { min: 4, max: 6, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: 'fire',
			primaryCount: 42,
			reasoning:
				'Fire plays need slightly less weapon density than Steel because the persistent buffs (Fire Boost, Eternal Flame) only need to fire once to be valuable for the rest of the game.'
		},
		projectedMetrics: { hdEndOfGame: 1, playsActivated: 7, subsNeeded: 0.7 },
		bestFormats: ['spec_playmaker', 'apex_playmaker', 'elite_playmaker'],
		difficulty: 'beginner'
	},
	{
		id: 'free_play_engine',
		name: 'Free Play Engine',
		tagline: 'Never run out of resources',
		description:
			'Ignore weapon synergy entirely. Fill the deck with the best 0 HD plays. Activate a play every battle without spending a single hot dog. Save all 10 HD for substitutions and 1-2 critical power plays. Run the highest-power heroes across ALL weapon types.',
		comboEngines: ['coin_flip_control'],
		categoryAllocation: {
			free_play: { min: 15, max: 20, priority: 1 },
			power_boost: { min: 6, max: 10, priority: 2 },
			draw_play: { min: 4, max: 6, priority: 3 },
			hd_recovery: { min: 2, max: 4, priority: 4 },
			coin_flip: { min: 4, max: 8, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: null,
			primaryCount: 0,
			reasoning:
				'Weapon-agnostic. Pick the 60 highest-power heroes available in the format regardless of weapon type. All 10 HD are available for substitutions to optimize power in each zone.'
		},
		projectedMetrics: { hdEndOfGame: 4, playsActivated: 9, subsNeeded: 2 },
		bestFormats: ['spec_playmaker', 'elite_playmaker', 'spec_plus'],
		difficulty: 'intermediate'
	},
	{
		id: 'starvation',
		name: 'Hot Dog Denial',
		tagline: "They can't play if they can't pay",
		description:
			"Drain the opponent's hot dogs while operating on free plays yourself. The asymmetric resource war — you planned for mutual starvation, they didn't.",
		comboEngines: ['starvation_lock', 'recovery_snowball'],
		categoryAllocation: {
			hd_attack: { min: 4, max: 6, priority: 1 },
			free_play: { min: 10, max: 15, priority: 2 },
			persistent: { min: 3, max: 5, priority: 3 },
			power_boost: { min: 4, max: 6, priority: 4 },
			draw_play: { min: 3, max: 5, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: null,
			primaryCount: 0,
			reasoning:
				"Weapon-agnostic. The strategy doesn't depend on weapon-specific plays. Run highest-power heroes."
		},
		projectedMetrics: { hdEndOfGame: 0, playsActivated: 6, subsNeeded: 1 },
		bestFormats: ['apex_playmaker', 'elite_playmaker'],
		difficulty: 'advanced'
	},
	{
		id: 'dice_aggro',
		name: 'Dice Aggro',
		tagline: 'High variance, high ceiling',
		description:
			'Build around the Dice Engine for card advantage and opponent penalties, with dice-roll power plays for explosive turns. Deep In The Playbook draws you extra plays every time anyone rolls, creating a snowballing advantage.',
		comboEngines: ['dice_engine'],
		categoryAllocation: {
			dice_roll: { min: 8, max: 12, priority: 1 },
			draw_play: { min: 4, max: 6, priority: 2 },
			persistent: { min: 2, max: 3, priority: 3 },
			power_boost: { min: 4, max: 6, priority: 4 },
			hd_recovery: { min: 3, max: 4, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: null,
			primaryCount: 0,
			reasoning:
				"Weapon-agnostic. The Dice Engine doesn't require any specific weapon type."
		},
		projectedMetrics: { hdEndOfGame: 1, playsActivated: 10, subsNeeded: 1 },
		bestFormats: ['apex_playmaker', 'spec_playmaker'],
		difficulty: 'intermediate'
	},
	{
		id: 'late_game_bomb',
		name: 'Late Game Bomb',
		tagline: 'Survive early, dominate late',
		description:
			'Play conservatively in Battles 1-4, then deploy timing-specific plays in Battles 5-7 for overwhelming late-game advantage. The Closer (+40 in Battle 7), Late Hit (-35 in Battle 7), and the Comeback Engine work together.',
		comboEngines: ['lose_to_win', 'recovery_snowball'],
		categoryAllocation: {
			comeback: { min: 4, max: 7, priority: 1 },
			scaling: { min: 3, max: 5, priority: 2 },
			hd_recovery: { min: 4, max: 6, priority: 3 },
			draw_play: { min: 4, max: 6, priority: 4 },
			power_boost: { min: 4, max: 6, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: null,
			primaryCount: 0,
			reasoning:
				'Weapon-agnostic. Place low-power heroes in early zones, reserve high-power heroes for Battles 5-7.'
		},
		projectedMetrics: { hdEndOfGame: 3, playsActivated: 8, subsNeeded: 1 },
		bestFormats: ['apex_playmaker', 'spec_playmaker', 'elite_playmaker'],
		difficulty: 'advanced'
	},
	{
		id: 'cleanse_wall',
		name: 'The Cleanse Wall',
		tagline: 'Erase every debuff, gain power doing it',
		description:
			'Free substitutions cleanse opponent debuffs (Rule 3.2: cards lose applied effects when moving between zones). Substitution Boost converts each cleanse into +5 permanent. No More Subs locks the opponent into bad draws while you adapt freely. Low DBS commitment, beginner-friendly, hard to play against.',
		comboEngines: ['substitution_cleanse', 'unlimited_subs'],
		categoryAllocation: {
			sub_denial: { min: 1, max: 3, priority: 1 },
			power_boost: { min: 6, max: 10, priority: 2 },
			draw_play: { min: 4, max: 6, priority: 3 },
			hd_recovery: { min: 3, max: 5, priority: 4 },
			persistent: { min: 2, max: 4, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: null,
			primaryCount: 0,
			reasoning:
				"The cleanse engine is weapon-agnostic — substitutions erase debuffs regardless of weapon type. Run the highest-power heroes available across all weapons. If you happen to have many Steel/Fire/Ice heroes, you'll naturally pair well with Substitution Boost stacks."
		},
		projectedMetrics: { hdEndOfGame: 4, playsActivated: 6, subsNeeded: 4 },
		bestFormats: ['spec_playmaker', 'elite_playmaker', 'spec_plus', 'apex_playmaker'],
		difficulty: 'intermediate'
	},
	{
		id: 'permanent_stack',
		name: 'The Permanent Stack',
		tagline: 'Invest early, dominate forever',
		description:
			'Front-load Battles 1-3 with persistent buffs and debuffs. Noble Sacrifice (+10 all your heroes), Member Bounce (+10 all your heroes), and The 12th Man (-10 all opponent heroes) create a +30 power swing per battle that compounds for the rest of the game. Pair with Recovery Snowball to fund the 8 HD upfront cost.',
		comboEngines: ['noble_sacrifice_stack', 'recovery_snowball'],
		categoryAllocation: {
			persistent: { min: 5, max: 8, priority: 1 },
			hd_recovery: { min: 4, max: 6, priority: 2 },
			power_boost: { min: 4, max: 6, priority: 3 },
			draw_play: { min: 4, max: 6, priority: 4 },
			scaling: { min: 2, max: 4, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: null,
			primaryCount: 0,
			reasoning:
				"The persistent buff stack works regardless of weapon type. If you happen to commit to one weapon (Steel, Fire, or Ice), you can layer Weapon Boost on top of Noble Sacrifice for +20 instead of +10 to your matched heroes — but it's not required. Run highest-power heroes available."
		},
		projectedMetrics: { hdEndOfGame: 1, playsActivated: 7, subsNeeded: 1 },
		bestFormats: ['apex_playmaker', 'spec_playmaker', 'elite_playmaker'],
		difficulty: 'advanced'
	},
	{
		id: 'mono_ice_cold_lock',
		name: 'Cold Lock',
		tagline: 'Freeze the opponent into submission',
		description:
			'The Ice mirror to Steel Fortress and Fire Rush. Cold Pressure adds passive damage every battle. Ice Boost stacks +10 permanent for Ice heroes. Frozen Flip and Ice Blast give cheap coin-flip damage scaled by Ice weapon ownership. Heavy Ice density makes weapon-specific plays fire reliably.',
		comboEngines: ['recovery_snowball'],
		categoryAllocation: {
			weapon_ice: { min: 7, max: 10, priority: 1 },
			persistent: { min: 3, max: 5, priority: 2 },
			hd_recovery: { min: 3, max: 5, priority: 3 },
			draw_play: { min: 4, max: 6, priority: 4 },
			power_boost: { min: 4, max: 6, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: 'ice',
			primaryCount: 42,
			reasoning:
				'The strategy is built around Ice-specific plays — you want most of your heroes to have Ice weapons so those plays fire in nearly every battle. At ~42/60 Ice heroes, plays like Cold Pressure and Ice Boost trigger reliably and you only need 1-2 substitutions to weapon-match per game.'
		},
		projectedMetrics: { hdEndOfGame: 1, playsActivated: 7, subsNeeded: 1 },
		bestFormats: ['spec_playmaker', 'apex_playmaker', 'elite_playmaker', 'spec_plus'],
		difficulty: 'beginner'
	},
	{
		id: 'twin_engine_aggro',
		name: 'Twin-Engine Aggro',
		tagline: 'Stacked variance, doubled ceiling',
		description:
			"Run Coin Flip Control AND The Dice Engine together. Both engines have low-DBS cores (Loan Sharked + Deep In The Playbook + Pay The Price + Leave It To Chance) so both fit under 1000 DBS. Every random element triggers something — coin flips deal -5 from Loan Sharked, dice rolls draw plays from Deep In The Playbook AND damage opponents from Pay The Price. Chaos is the strategy.",
		comboEngines: ['coin_flip_control', 'dice_engine'],
		categoryAllocation: {
			coin_flip: { min: 5, max: 9, priority: 1 },
			dice_roll: { min: 5, max: 8, priority: 2 },
			draw_play: { min: 3, max: 5, priority: 3 },
			power_boost: { min: 4, max: 6, priority: 4 },
			hd_recovery: { min: 2, max: 4, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: null,
			primaryCount: 0,
			reasoning:
				"Weapon-agnostic. Both engines fire off random elements, not weapon types. Run the highest-power heroes available across all weapon types. Some flipper plays (Steel Smash, Frozen Flip, Flaming Flip, Stainless Flip) are weapon-aware, so a slight lean toward Steel, Fire, or Ice gives marginal extra value — but it's optional, not required."
		},
		projectedMetrics: { hdEndOfGame: 2, playsActivated: 9, subsNeeded: 1 },
		bestFormats: ['apex_playmaker', 'spec_playmaker', 'elite_playmaker'],
		difficulty: 'intermediate'
	},
	{
		id: 'nullify_wall',
		name: 'Nullify Wall',
		tagline: "Kill their persistents before they activate",
		description:
			"The counter-meta archetype. Bounce or nullify opponent plays that have ongoing effects — Rule 5.1.7 means returned plays lose their persistent buffs retroactively. Eats Permanent Stack, Mono-Weapon Buff, and any deck that relies on rest-of-game effects. Pair with sub-denial to lock opponents out of escaping. NOTE: nullify card identification is in progress; expect this archetype to seed best via the 'Filler' top-up logic until the engine list firms up.",
		comboEngines: ['ongoing_kill_switch', 'unlimited_subs'],
		categoryAllocation: {
			nullify: { min: 4, max: 8, priority: 1 },
			sub_denial: { min: 2, max: 4, priority: 2 },
			draw_play: { min: 4, max: 6, priority: 3 },
			power_boost: { min: 4, max: 6, priority: 4 },
			hd_recovery: { min: 3, max: 5, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: null,
			primaryCount: 0,
			reasoning:
				"Weapon-agnostic. Nullify and bounce plays don't care about hero weapon types. Run the highest-power heroes across all weapons. The strategy succeeds or fails on play timing, not on hero composition."
		},
		projectedMetrics: { hdEndOfGame: 2, playsActivated: 7, subsNeeded: 1 },
		bestFormats: ['apex_playmaker', 'spec_playmaker', 'elite_playmaker'],
		difficulty: 'advanced'
	},
	{
		id: 'marathon_free_play',
		name: 'Marathon',
		tagline: 'Free plays forever, big finish',
		description:
			"Free Play Engine extended with Recovery Snowball. The base archetype runs 0 HD plays every battle but struggles to afford the 1-2 critical paid power plays at the end. Marathon adds Bonus Recovery + 4-5 recovery plays to amplify your HD pool, letting you bank for a Battle 7 Full Court Press or similar finisher. Slightly more complex than Free Play Engine but with a higher ceiling.",
		comboEngines: ['coin_flip_control', 'recovery_snowball'],
		categoryAllocation: {
			free_play: { min: 12, max: 18, priority: 1 },
			hd_recovery: { min: 4, max: 6, priority: 2 },
			power_boost: { min: 5, max: 8, priority: 3 },
			draw_play: { min: 4, max: 6, priority: 4 },
			coin_flip: { min: 3, max: 6, priority: 5 }
		},
		heroRecommendation: {
			primaryWeapon: null,
			primaryCount: 0,
			reasoning:
				"Weapon-agnostic — pick the 60 highest-power heroes available regardless of weapon. The strategy doesn't depend on weapon-specific plays, and your full HD pool is available for substitutions to optimize hero placement in each zone."
		},
		projectedMetrics: { hdEndOfGame: 3, playsActivated: 10, subsNeeded: 2 },
		bestFormats: ['spec_playmaker', 'elite_playmaker', 'apex_playmaker'],
		difficulty: 'intermediate'
	}
];

export function getArchetype(id: string): PlaybookArchetype | undefined {
	return PLAYBOOK_ARCHETYPES.find((a) => a.id === id);
}
