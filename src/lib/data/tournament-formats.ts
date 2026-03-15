/**
 * BoBA Tournament Format Definitions
 *
 * Each format defines the complete set of deck construction constraints.
 * The deck validator reads these rules and checks a submitted deck against them.
 *
 * IMPORTANT: The "max 6 of a single hero character" rule has been removed.
 * Players may include any number of the same hero across different variations.
 */

export type GameMode = 'playmaker' | 'rookie' | 'substitution';

export interface FormatRules {
	/** Unique format identifier */
	id: string;
	/** Display name */
	name: string;
	/** Short description */
	description: string;
	/** Game mode used in this format */
	gameMode: GameMode;
	/** Whether this is a team format */
	isTeamFormat: boolean;

	// --- Hero Deck constraints ---
	/** Minimum number of Hero cards in the deck */
	heroDeckMin: number;
	/** Maximum number of Hero cards (null = same as min, i.e. exact count required) */
	heroDeckMax: number | null;
	/** SPEC power cap: max power value for any individual Hero card. null = no cap */
	specPowerCap: number | null;
	/** Combined Power cap: max sum of all Hero power values. null = no cap */
	combinedPowerCap: number | null;
	/** Max copies of a single Hero at the same power level */
	maxPerPowerLevel: number;
	/** Max copies of a single unique card variation (hero + weapon + parallel combination) */
	maxPerVariation: number;

	// --- Hot Dog Deck constraints ---
	/** Number of Hot Dog cards required */
	hotDogDeckSize: number;
	/** Whether foil Hot Dogs are required (e.g., Madness Head Coach) */
	requiresFoilHotDogs: boolean;
	/** How many foil Hot Dogs are required (0 if not required) */
	requiredFoilHotDogCount: number;

	// --- Playbook constraints ---
	/** Number of unique Play cards required */
	playDeckSize: number;
	/** Whether Bonus Plays (Short Print ultra-rares) are allowed beyond the base 30 */
	bonusPlaysAllowed: boolean;
	/** Max Bonus Plays allowed (25 is standard, 0 if not allowed) */
	maxBonusPlays: number;
	/** DBS (Deck Balancing Score) cap for the Playbook. null = no DBS cap */
	dbsCap: number | null;

	// --- Card pool restrictions ---
	/** If set, only these parallel/insert types are legal in this format */
	allowedParallels: string[] | null;
	/** If set, only these weapon types are legal */
	allowedWeapons: string[] | null;
	/** If true, Plays and Hot Dogs are not used in gameplay (Rookie Mode) */
	heroOnlyGameplay: boolean;

	// --- Apex Madness specific ---
	/** Madness insert-unlock mechanic: how many of one insert type to unlock an Apex card */
	madnessInsertUnlockThreshold: number | null;
	/** Max Apex cards unlockable via the insert mechanic */
	madnessMaxInsertUnlocks: number | null;
	/** Max Apex cards unlockable via foil Hot Dog bonus */
	madnessFoilHotDogBonusCards: number | null;
	/** Min power for a card to qualify as "Apex" in Madness */
	madnessApexMinPower: number | null;

	// --- Team format specific ---
	/** Team size range (null if not a team format) */
	teamSize: { min: number; max: number } | null;
	/** Number of players who compete each round */
	playersPerRound: number | null;
}

export const TOURNAMENT_FORMATS: FormatRules[] = [
	{
		id: 'apex_playmaker',
		name: 'Apex Playmaker',
		description: 'Premier solo format. Standard deck rules, no power cap, 45 standard plays registered.',
		gameMode: 'playmaker',
		isTeamFormat: false,
		heroDeckMin: 60,
		heroDeckMax: null,
		specPowerCap: null,
		combinedPowerCap: null,
		maxPerPowerLevel: 6,
		maxPerVariation: 1,
		hotDogDeckSize: 10,
		requiresFoilHotDogs: false,
		requiredFoilHotDogCount: 0,
		playDeckSize: 30,
		bonusPlaysAllowed: true,
		maxBonusPlays: 25,
		dbsCap: 1000,
		allowedParallels: null,
		allowedWeapons: null,
		heroOnlyGameplay: false,
		madnessInsertUnlockThreshold: null,
		madnessMaxInsertUnlocks: null,
		madnessFoilHotDogBonusCards: null,
		madnessApexMinPower: null,
		teamSize: null,
		playersPerRound: null
	},
	{
		id: 'spec_playmaker',
		name: 'SPEC Playmaker',
		description: 'Standard competitive format. No individual Hero card may exceed 160 Power.',
		gameMode: 'playmaker',
		isTeamFormat: false,
		heroDeckMin: 60,
		heroDeckMax: null,
		specPowerCap: 160,
		combinedPowerCap: null,
		maxPerPowerLevel: 6,
		maxPerVariation: 1,
		hotDogDeckSize: 10,
		requiresFoilHotDogs: false,
		requiredFoilHotDogCount: 0,
		playDeckSize: 30,
		bonusPlaysAllowed: true,
		maxBonusPlays: 25,
		dbsCap: 1000,
		allowedParallels: null,
		allowedWeapons: null,
		heroOnlyGameplay: false,
		madnessInsertUnlockThreshold: null,
		madnessMaxInsertUnlocks: null,
		madnessFoilHotDogBonusCards: null,
		madnessApexMinPower: null,
		teamSize: null,
		playersPerRound: null
	},
	{
		id: 'elite_playmaker',
		name: 'Elite Playmaker',
		description: 'Salary cap format. Total power across all 60 Heroes must not exceed 8,250.',
		gameMode: 'playmaker',
		isTeamFormat: false,
		heroDeckMin: 60,
		heroDeckMax: null,
		specPowerCap: null,
		combinedPowerCap: 8250,
		maxPerPowerLevel: 6,
		maxPerVariation: 1,
		hotDogDeckSize: 10,
		requiresFoilHotDogs: false,
		requiredFoilHotDogCount: 0,
		playDeckSize: 30,
		bonusPlaysAllowed: true,
		maxBonusPlays: 25,
		dbsCap: 1000,
		allowedParallels: null,
		allowedWeapons: null,
		heroOnlyGameplay: false,
		madnessInsertUnlockThreshold: null,
		madnessMaxInsertUnlocks: null,
		madnessFoilHotDogBonusCards: null,
		madnessApexMinPower: null,
		teamSize: null,
		playersPerRound: null
	},
	{
		id: 'apex_madness',
		name: 'Apex Madness',
		description: 'Team Rookie Mode. 4-6 player squads, Core Deck at 160 SPEC + Expanded Deck via insert unlocks.',
		gameMode: 'rookie',
		isTeamFormat: true,
		heroDeckMin: 60,
		heroDeckMax: 70,
		specPowerCap: 160,
		combinedPowerCap: null,
		maxPerPowerLevel: 6,
		maxPerVariation: 1,
		hotDogDeckSize: 10,
		requiresFoilHotDogs: true,
		requiredFoilHotDogCount: 4,
		playDeckSize: 0,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: null,
		allowedParallels: null,
		allowedWeapons: null,
		heroOnlyGameplay: true,
		madnessInsertUnlockThreshold: 10,
		madnessMaxInsertUnlocks: 6,
		madnessFoilHotDogBonusCards: 4,
		madnessApexMinPower: 165,
		teamSize: { min: 4, max: 6 },
		playersPerRound: 4
	},
	{
		id: 'blizzard_bowl',
		name: "80's Blizzard Bowl",
		description: 'Theme format: only Blizzard, 80s Rad, and Grandma\'s Linoleum Battlefoils allowed.',
		gameMode: 'substitution',
		isTeamFormat: false,
		heroDeckMin: 60,
		heroDeckMax: 70,
		specPowerCap: 160,
		combinedPowerCap: null,
		maxPerPowerLevel: 6,
		maxPerVariation: 1,
		hotDogDeckSize: 10,
		requiresFoilHotDogs: false,
		requiredFoilHotDogCount: 0,
		playDeckSize: 30,
		bonusPlaysAllowed: true,
		maxBonusPlays: 25,
		dbsCap: 1000,
		allowedParallels: ['blizzard', '80s_rad', 'grandmas_linoleum'],
		allowedWeapons: null,
		heroOnlyGameplay: false,
		madnessInsertUnlockThreshold: null,
		madnessMaxInsertUnlocks: null,
		madnessFoilHotDogBonusCards: null,
		madnessApexMinPower: null,
		teamSize: null,
		playersPerRound: null
	},
	{
		id: 'silver_headlines',
		name: 'The Silver Headlines',
		description: 'Only Silver and Headline Battlefoils. No Bonus Plays. Steel weapon dominant.',
		gameMode: 'playmaker',
		isTeamFormat: false,
		heroDeckMin: 60,
		heroDeckMax: null,
		specPowerCap: null,
		combinedPowerCap: null,
		maxPerPowerLevel: 6,
		maxPerVariation: 1,
		hotDogDeckSize: 10,
		requiresFoilHotDogs: false,
		requiredFoilHotDogCount: 0,
		playDeckSize: 30,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: 1000,
		allowedParallels: ['silver', 'headlines'],
		allowedWeapons: null,
		heroOnlyGameplay: false,
		madnessInsertUnlockThreshold: null,
		madnessMaxInsertUnlocks: null,
		madnessFoilHotDogBonusCards: null,
		madnessApexMinPower: null,
		teamSize: null,
		playersPerRound: null
	}
];

/** Get a format by ID */
export function getFormat(id: string): FormatRules | undefined {
	return TOURNAMENT_FORMATS.find(f => f.id === id);
}

/** Get all format IDs and names (for UI dropdowns) */
export function getFormatOptions(): Array<{ id: string; name: string }> {
	return TOURNAMENT_FORMATS.map(f => ({ id: f.id, name: f.name }));
}
