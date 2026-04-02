/**
 * BoBA 2026 Tournament Format Definitions
 *
 * Each format defines the complete set of deck construction constraints.
 * The deck validator reads these rules and checks a submitted deck against them.
 *
 * IMPORTANT TERMINOLOGY:
 * - "Coach" = player (BoBA uses "Coach" officially)
 * - "Registered Play Pool" = up to 45 standard plays + unlimited bonus plays
 *   that a Coach registers before the event. Coaches may swap plays between
 *   matches from their pool to form any legal 30-play deck, but the deck is
 *   locked within a match. This is NOT a traditional sideboard.
 * - "ELP" (Event Legal Proxy) = rental proxy for graded cards ($1,500+),
 *   completely separate from deck construction.
 *
 * RULE: Coaches may include any number of the same hero character across
 * different variations (hero + weapon + parallel must be unique).
 */

export type GameMode = 'playmaker' | 'rookie' | 'substitution';

export type CardPool =
	| 'modern'                    // Most recent 2 years of releases
	| 'alpha_trilogy'             // Cards released before Nov 1, 2025
	| 'hall_of_fame'              // Cards older than 2 calendar years (as of Jan 1)
	| 'all_in_rotation'           // Any currently legal cards
	| 'tecmo_only'                // Tecmo Bowl set only
	| 'blast_only'                // Blast set only
	| 'brawl_weapons_only'        // Heroes with Brawl weapon type only
	| 'power_glove_only'          // Power Glove inserts only
	| 'grannys_gum_only'          // Grandma's/Great Grandma's Linoleum + Bubblegum only
	| 'blizzard_bowl_inserts'     // Blizzard, Rad, Grandma's Linoleum Battlefoils only
	| 'silver_headlines_inserts'; // Silver and Headliner Battlefoils only

export interface FormatRules {
	/** Unique format identifier */
	id: string;
	/** Display name */
	name: string;
	/** Short description */
	description: string;
	/** Tournament division (e.g., 'APEX', 'Open', 'Brawl') */
	division: string;
	/** Card pool restriction — which cards are legal by set/release */
	cardPool: CardPool;
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
	/** Restriction on Hot Dog type (e.g., 'brawler', 'blast'). null = any */
	hotDogRestriction: string | null;

	// --- Playbook constraints ---
	/** Number of unique Play cards in the active deck (usually 30) */
	playDeckSize: number;
	/** Whether Bonus Plays (Short Print ultra-rares) are allowed beyond the base 30 */
	bonusPlaysAllowed: boolean;
	/** Max Bonus Plays allowed (25 is standard, 0 if not allowed) */
	maxBonusPlays: number;
	/** DBS (Deck Balancing Score) cap for the Playbook. null = no DBS cap */
	dbsCap: number | null;
	/** Whether Hot Dog Trading (HTD) plays are allowed */
	htdPlays: boolean;

	// --- Play Registration (NOT "sideboard") ---
	/** Max standard plays a Coach can register for the event (swappable between matches) */
	maxRegisteredPlays: number;
	/** Whether bonus play registration is unlimited */
	unlimitedBonusRegistration: boolean;
	/** Whether Coaches may swap plays from their registered pool between matches */
	swappableBetweenMatches: boolean;

	// --- Card pool restrictions ---
	/** If set, only these parallel/insert types are legal in this format */
	allowedParallels: string[] | null;
	/** If set, only these weapon types are legal */
	allowedWeapons: string[] | null;
	/** If true, Plays and Hot Dogs are not used in gameplay (Rookie Mode) */
	heroOnlyGameplay: boolean;

	// --- Optional game mechanics ---
	/** Double-Up: first to 7 points wins, Coaches may "Press" to double game value */
	doubleUp: boolean;
	/** Low Ball: lowest power wins instead of highest */
	lowBall: boolean;
	/** HiLo: Head Coach plays high (standard), other Coaches play Low Ball */
	hiLo: boolean;

	// --- Apex Madness specific ---
	/** Madness insert-unlock mechanic: how many of one insert type to unlock an Apex card */
	madnessInsertUnlockThreshold: number | null;
	/** Max Apex cards unlockable via the insert mechanic */
	madnessMaxInsertUnlocks: number | null;
	/** Max Apex cards unlockable via foil Hot Dog bonus */
	madnessFoilHotDogBonusCards: number | null;
	/** Min power for a card to qualify as "Apex" in Madness */
	madnessApexMinPower: number | null;

	// --- Graduated power slots (SPEC+) ---
	/** If true, heroDeckMin cards must be ≤ specPowerCap (or ≤160 if specPowerCap is null) */
	requiresSpecCore: boolean;
	/** Per-power-level slot maximums for graduated formats like SPEC+. Maps power value → max count allowed. null = use maxPerPowerLevel for all. */
	powerSlotLimits: Record<number, number> | null;
	/** Absolute max power — cards above this are illegal regardless of other caps. null = no absolute max. */
	absoluteMaxPower: number | null;

	// --- Team format specific ---
	/** Team size range (null if not a team format) */
	teamSize: { min: number; max: number } | null;
	/** Number of Coaches who compete each round */
	playersPerRound: number | null;

	// --- Entry & prize info (display only) ---
	/** Entry requirement description */
	entryRequirement?: string;
	/** Prize pool description */
	prizePool?: string;
	/** Pro Player Series points per entry */
	ppsPerEntry?: number;
	/** Additional special rules for display */
	specialRules?: string[];
}

// ── Helper to build a format with sensible defaults ────────────────

function defineFormat(overrides: Partial<FormatRules> & Pick<FormatRules, 'id' | 'name' | 'description' | 'division' | 'cardPool' | 'gameMode'>): FormatRules {
	return {
		// Identity
		isTeamFormat: false,

		// Hero deck defaults
		heroDeckMin: 60,
		heroDeckMax: null,
		specPowerCap: null,
		combinedPowerCap: null,
		maxPerPowerLevel: 6,
		maxPerVariation: 1,

		// Hot Dog defaults
		hotDogDeckSize: 10,
		requiresFoilHotDogs: false,
		requiredFoilHotDogCount: 0,
		hotDogRestriction: null,

		// Playbook defaults
		playDeckSize: 30,
		bonusPlaysAllowed: true,
		maxBonusPlays: 25,
		dbsCap: 1000,
		htdPlays: true,

		// Play registration defaults
		maxRegisteredPlays: 45,
		unlimitedBonusRegistration: true,
		swappableBetweenMatches: true,

		// Card pool defaults
		allowedParallels: null,
		allowedWeapons: null,
		heroOnlyGameplay: false,

		// Game mechanics defaults
		doubleUp: false,
		lowBall: false,
		hiLo: false,

		// Madness defaults
		madnessInsertUnlockThreshold: null,
		madnessMaxInsertUnlocks: null,
		madnessFoilHotDogBonusCards: null,
		madnessApexMinPower: null,

		// Graduated power defaults
		requiresSpecCore: false,
		powerSlotLimits: null,
		absoluteMaxPower: null,

		// Team defaults
		teamSize: null,
		playersPerRound: null,

		// Apply overrides
		...overrides
	};
}

// ── Shared SPEC+ power slot limits ────────────────────────────────

const SPEC_PLUS_POWER_SLOTS: Record<number, number> = {
	165: 2, 170: 2, 175: 1, 180: 1, 185: 1, 190: 1, 195: 1, 200: 1
};

// ── Shared Madness config ─────────────────────────────────────────

const MADNESS_DEFAULTS = {
	gameMode: 'rookie' as GameMode,
	isTeamFormat: true,
	heroDeckMin: 60,
	heroDeckMax: 70,
	specPowerCap: 160,
	heroOnlyGameplay: true,
	playDeckSize: 0,
	bonusPlaysAllowed: false,
	maxBonusPlays: 0,
	dbsCap: null,
	htdPlays: false,
	maxRegisteredPlays: 0,
	unlimitedBonusRegistration: false,
	swappableBetweenMatches: false,
	requiresFoilHotDogs: true,
	requiredFoilHotDogCount: 4,
	madnessInsertUnlockThreshold: 10,
	madnessMaxInsertUnlocks: 6,
	madnessFoilHotDogBonusCards: 4,
	madnessApexMinPower: 165,
	teamSize: { min: 4, max: 6 },
	playersPerRound: 4
};

// ══════════════════════════════════════════════════════════════════
// FORMAT DEFINITIONS — 2026 World Championships & Organized Play
// ══════════════════════════════════════════════════════════════════

export const TOURNAMENT_FORMATS: FormatRules[] = [
	// ─── APEX DIVISION ($150,000) ─────────────────────────────────

	defineFormat({
		id: 'apex_playmaker',
		name: 'APEX Playmaker',
		description: 'Premier solo format. No power cap. Register up to 45 standard plays + unlimited bonus plays, swappable between matches.',
		division: 'APEX',
		cardPool: 'all_in_rotation',
		gameMode: 'playmaker',
		entryRequirement: "N'25 Football Breaker BoJax /99 Auto",
		prizePool: '$150,000 division',
		ppsPerEntry: 2
	}),

	defineFormat({
		id: 'apex_blitz',
		name: 'APEX Blitz',
		description: 'Rookie mode with APEX deck rules. No power cap, no plays.',
		division: 'APEX',
		cardPool: 'all_in_rotation',
		gameMode: 'rookie',
		heroOnlyGameplay: true,
		playDeckSize: 0,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: null,
		htdPlays: false,
		maxRegisteredPlays: 0,
		unlimitedBonusRegistration: false,
		swappableBetweenMatches: false,
		hotDogDeckSize: 0,
		ppsPerEntry: 1,
		prizePool: '$150,000 division'
	}),

	defineFormat({
		id: 'apex_madness',
		name: 'APEX Madness',
		description: 'Team Rookie Mode. 4–6 Coach squads. Core Deck at SPEC 160 + Expanded Deck via insert unlocks.',
		division: 'APEX',
		cardPool: 'all_in_rotation',
		...MADNESS_DEFAULTS,
		entryRequirement: "N'25 Football Breaker BoJax /99 Auto (1 per team)",
		prizePool: '$150,000 division',
		ppsPerEntry: 7
	}),

	// ─── ALPHA TRILOGY DIVISION ($100,000) ─────────────────────────

	defineFormat({
		id: 'alpha_trilogy_playmaker',
		name: 'AlphaTrilogy Playmaker',
		description: 'APEX deck rules with Alpha-only card pool. Cards released before Nov 1, 2025.',
		division: 'AlphaTrilogy',
		cardPool: 'alpha_trilogy',
		gameMode: 'playmaker',
		entryRequirement: "N'24 Bat Breaker BoJax /99 Auto",
		prizePool: '$100,000 division',
		ppsPerEntry: 2
	}),

	defineFormat({
		id: 'alpha_trilogy_blitz',
		name: 'AlphaTrilogy Blitz',
		description: 'Rookie mode with APEX deck rules. Alpha-only card pool.',
		division: 'AlphaTrilogy',
		cardPool: 'alpha_trilogy',
		gameMode: 'rookie',
		heroOnlyGameplay: true,
		playDeckSize: 0,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: null,
		htdPlays: false,
		maxRegisteredPlays: 0,
		unlimitedBonusRegistration: false,
		swappableBetweenMatches: false,
		hotDogDeckSize: 0,
		ppsPerEntry: 1,
		prizePool: '$100,000 division'
	}),

	defineFormat({
		id: 'alpha_trilogy_madness',
		name: 'AlphaTrilogy Madness',
		description: 'Team Rookie Mode with Alpha-only card pool. APEX Madness rules.',
		division: 'AlphaTrilogy',
		cardPool: 'alpha_trilogy',
		...MADNESS_DEFAULTS,
		entryRequirement: "N'24 Bat Breaker BoJax /99 Auto (1 per team)",
		prizePool: '$100,000 division',
		ppsPerEntry: 7
	}),

	// ─── OPEN DIVISION (up to $40,000) ────────────────────────────

	defineFormat({
		id: 'spec_playmaker',
		name: 'SPEC Playmaker',
		description: 'Standard competitive format. No individual Hero card may exceed 160 Power. No Bonus Plays. No HTD Plays.',
		division: 'Open',
		cardPool: 'all_in_rotation',
		gameMode: 'playmaker',
		specPowerCap: 160,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		htdPlays: false,
		prizePool: '$40,000 division',
		ppsPerEntry: 2,
		specialRules: ['Collector Bonus: single-insert Hero Deck doubles cash prize (Supers count as wild)']
	}),

	defineFormat({
		id: 'elite_playmaker',
		name: 'Elite Playmaker',
		description: 'Combined Power format: 8,250 total power cap across all Heroes. No individual SPEC cap. Starters allowed, Trainers not legal.',
		division: 'Open',
		cardPool: 'all_in_rotation',
		gameMode: 'playmaker',
		combinedPowerCap: 8250,
		prizePool: '$40,000 division',
		ppsPerEntry: 3,
		specialRules: ['Starters: LEGAL', 'Trainers: NOT LEGAL']
	}),

	defineFormat({
		id: 'spec_plus',
		name: 'SPEC+',
		description: 'Up to 70 Heroes. Core 60 at SPEC 160, plus graduated power slots up to 200. No combined power cap.',
		division: 'Open',
		cardPool: 'all_in_rotation',
		gameMode: 'playmaker',
		heroDeckMax: 70,
		requiresSpecCore: true,
		powerSlotLimits: SPEC_PLUS_POWER_SLOTS,
		absoluteMaxPower: 200
	}),

	defineFormat({
		id: 'spec_plus_rookie_double_up',
		name: 'SPEC+ Rookie Double-Up',
		description: 'SPEC+ deck rules with Rookie mode and Double-Up scoring.',
		division: 'Open',
		cardPool: 'all_in_rotation',
		gameMode: 'rookie',
		heroDeckMax: 70,
		requiresSpecCore: true,
		powerSlotLimits: SPEC_PLUS_POWER_SLOTS,
		absoluteMaxPower: 200,
		heroOnlyGameplay: true,
		playDeckSize: 0,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: null,
		htdPlays: false,
		maxRegisteredPlays: 0,
		unlimitedBonusRegistration: false,
		swappableBetweenMatches: false,
		hotDogDeckSize: 0,
		doubleUp: true,
		ppsPerEntry: 3,
		prizePool: '$40,000 division'
	}),

	// ─── TECMO BOWL DIVISION ($50,000) ────────────────────────────

	defineFormat({
		id: 'tecmo_spec_plus_playmaker',
		name: 'Tecmo Bowl SPEC+ Playmaker',
		description: 'SPEC+ deck rules. ALL cards must be from the Tecmo Bowl set.',
		division: 'Tecmo Bowl',
		cardPool: 'tecmo_only',
		gameMode: 'playmaker',
		heroDeckMax: 70,
		requiresSpecCore: true,
		powerSlotLimits: SPEC_PLUS_POWER_SLOTS,
		absoluteMaxPower: 200,
		htdPlays: false,
		ppsPerEntry: 1,
		prizePool: '$50,000 division',
		specialRules: ['ALL cards must be Tecmo Bowl', 'No HTD Plays (none exist in Tecmo)']
	}),

	defineFormat({
		id: 'tecmo_spec_plus_rookie_double_up',
		name: 'Tecmo SPEC+ Rookie Double-Up',
		description: 'SPEC+ deck rules with Rookie mode. Tecmo Bowl Heroes only.',
		division: 'Tecmo Bowl',
		cardPool: 'tecmo_only',
		gameMode: 'rookie',
		heroDeckMax: 70,
		requiresSpecCore: true,
		powerSlotLimits: SPEC_PLUS_POWER_SLOTS,
		absoluteMaxPower: 200,
		heroOnlyGameplay: true,
		playDeckSize: 0,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: null,
		htdPlays: false,
		maxRegisteredPlays: 0,
		unlimitedBonusRegistration: false,
		swappableBetweenMatches: false,
		hotDogDeckSize: 0,
		doubleUp: true,
		ppsPerEntry: 1,
		prizePool: '$50,000 division'
	}),

	// ─── BLAST DIVISION ($20,000) ─────────────────────────────────

	defineFormat({
		id: 'blast_sub_low_ball_double_up',
		name: 'Blast Substitution Low Ball Double-Up',
		description: 'ALL cards must be Blast. 30 Heroes, max 3 per power level. Low Ball (lowest power wins) + Double-Up.',
		division: 'Blast',
		cardPool: 'blast_only',
		gameMode: 'substitution',
		heroDeckMin: 30,
		maxPerPowerLevel: 3,
		hotDogRestriction: 'blast',
		doubleUp: true,
		lowBall: true,
		ppsPerEntry: 1,
		prizePool: '$20,000 division',
		specialRules: ['ALL cards must be Blast', 'Decks only need 30 Heroes (special 2026 rule)', 'All Hot Dogs must be Blast']
	}),

	defineFormat({
		id: 'blast_sub_double_up',
		name: 'Blast Substitution Double-Up',
		description: 'ALL cards must be Blast. 30 Heroes, max 3 per power level. Double-Up scoring.',
		division: 'Blast',
		cardPool: 'blast_only',
		gameMode: 'substitution',
		heroDeckMin: 30,
		maxPerPowerLevel: 3,
		hotDogRestriction: 'blast',
		doubleUp: true,
		ppsPerEntry: 1,
		prizePool: '$20,000 division',
		specialRules: ['ALL cards must be Blast', 'Decks only need 30 Heroes (special 2026 rule)', 'All Hot Dogs must be Blast']
	}),

	// ─── BRAWL DIVISION ($20,000) ─────────────────────────────────

	defineFormat({
		id: 'brawl_playmaker',
		name: 'Brawl Playmaker',
		description: 'All Heroes must have Brawl weapon type. All Hot Dogs must be Brawler. No power limit.',
		division: 'Brawl',
		cardPool: 'brawl_weapons_only',
		gameMode: 'playmaker',
		allowedWeapons: ['brawl'],
		hotDogRestriction: 'brawler',
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		htdPlays: false,
		ppsPerEntry: 1,
		prizePool: '$20,000 division'
	}),

	defineFormat({
		id: 'brawl_rookie_double_up',
		name: 'Brawl Rookie Double-Up',
		description: 'Brawl weapons only. Rookie mode with Double-Up scoring. No power limit.',
		division: 'Brawl',
		cardPool: 'brawl_weapons_only',
		gameMode: 'rookie',
		allowedWeapons: ['brawl'],
		hotDogRestriction: 'brawler',
		heroOnlyGameplay: true,
		playDeckSize: 0,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: null,
		htdPlays: false,
		maxRegisteredPlays: 0,
		unlimitedBonusRegistration: false,
		swappableBetweenMatches: false,
		hotDogDeckSize: 0,
		doubleUp: true,
		ppsPerEntry: 1,
		prizePool: '$20,000 division'
	}),

	defineFormat({
		id: 'brawl_hilo_madness',
		name: 'Brawl HiLo Madness',
		description: 'Team event. Brawl weapons only. Head Coach plays standard, others play Low Ball.',
		division: 'Brawl',
		cardPool: 'brawl_weapons_only',
		gameMode: 'rookie',
		isTeamFormat: true,
		allowedWeapons: ['brawl'],
		hotDogRestriction: 'brawler',
		heroOnlyGameplay: true,
		playDeckSize: 0,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: null,
		htdPlays: false,
		maxRegisteredPlays: 0,
		unlimitedBonusRegistration: false,
		swappableBetweenMatches: false,
		hiLo: true,
		teamSize: { min: 4, max: 6 },
		playersPerRound: 4,
		ppsPerEntry: 4,
		prizePool: '$20,000 division'
	}),

	// ─── GRANNY'S GUM DIVISION ($20,000) ──────────────────────────

	defineFormat({
		id: 'gg_hilo_madness',
		name: "Granny's Gum HiLo Madness",
		description: "Team event. Only Grandma's Linoleum, Great Grandma's Linoleum, and Bubblegum inserts. Head Coach plays high, others play Low Ball.",
		division: "Granny's Gum",
		cardPool: 'grannys_gum_only',
		gameMode: 'rookie',
		isTeamFormat: true,
		allowedParallels: [
			"grandma's linoleum", 'grandmas_linoleum',
			"great grandma's linoleum", 'great_grandmas_linoleum',
			'bubblegum', 'bubblegum auto', 'bubblegum_auto'
		],
		heroOnlyGameplay: true,
		playDeckSize: 0,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: null,
		htdPlays: false,
		maxRegisteredPlays: 0,
		unlimitedBonusRegistration: false,
		swappableBetweenMatches: false,
		hiLo: true,
		teamSize: { min: 4, max: 6 },
		playersPerRound: 4,
		prizePool: '$20,000 division',
		specialRules: [
			'Must have minimum 10 of each legal insert type',
			'No power cap (standard max 6 per power level)'
		]
	}),

	// ─── POWER GLOVE DIVISION ($15,000) ───────────────────────────

	defineFormat({
		id: 'power_glove_set_builder',
		name: 'Power Glove Set Builder Bracket',
		description: 'Rookie (Best of 7, Double Elimination). 60 unique Power Glove cards only. Entry requires 120+ unique Power Glove cards.',
		division: 'Power Glove',
		cardPool: 'power_glove_only',
		gameMode: 'rookie',
		heroOnlyGameplay: true,
		playDeckSize: 0,
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		dbsCap: null,
		htdPlays: false,
		maxRegisteredPlays: 0,
		unlimitedBonusRegistration: false,
		swappableBetweenMatches: false,
		hotDogDeckSize: 0,
		entryRequirement: 'Verified ownership of 120+ unique 2026 Edition (Griffey Set) Power Glove cards',
		prizePool: '$15,000 division ($10K base + $5K full set bonus)',
		specialRules: [
			'$5,000 Full Set Bonus if winner owns all 131 Power Glove cards',
			'Exclusive promo card/pack for all entrants (only obtainable by entering)',
			'Best of 7, Double Elimination bracket'
		]
	}),

	// ─── THEMED / SPECIAL FORMATS (SCG CON & Regionals) ──────────

	defineFormat({
		id: 'blizzard_bowl',
		name: "80's Blizzard Bowl",
		description: "Theme format: only Blizzard, 80s Rad, and Grandma's Linoleum Battlefoils. SPEC+ style: 60 core at ≤160, up to 10 additional above 160.",
		division: 'Themed',
		cardPool: 'blizzard_bowl_inserts',
		gameMode: 'substitution',
		heroDeckMax: 70,
		requiresSpecCore: true,
		powerSlotLimits: SPEC_PLUS_POWER_SLOTS,
		absoluteMaxPower: 200,
		allowedParallels: ['blizzard', '80s rad', '80s_rad', 'rad', "grandma's linoleum", 'grandmas_linoleum'],
		specialRules: ["Snowed in at Grandma's house in the 80's"]
	}),

	defineFormat({
		id: 'silver_headlines',
		name: 'The Silver Headlines',
		description: 'Only Silver and Headline Battlefoils (at least 20 of each). No Bonus Plays. No power cap — Steel weapon dominant.',
		division: 'Themed',
		cardPool: 'silver_headlines_inserts',
		gameMode: 'playmaker',
		allowedParallels: ['silver', 'headliner'],
		bonusPlaysAllowed: false,
		maxBonusPlays: 0,
		htdPlays: false,
		dbsCap: null
	})
];

/** Get a format by ID */
export function getFormat(id: string): FormatRules | undefined {
	return TOURNAMENT_FORMATS.find(f => f.id === id);
}

/** Get all format IDs and names (for UI dropdowns) */
export function getFormatOptions(): Array<{ id: string; name: string; division: string }> {
	return TOURNAMENT_FORMATS.map(f => ({ id: f.id, name: f.name, division: f.division }));
}

/** Get formats grouped by division */
export function getFormatsByDivision(): Record<string, FormatRules[]> {
	const grouped: Record<string, FormatRules[]> = {};
	for (const f of TOURNAMENT_FORMATS) {
		if (!grouped[f.division]) grouped[f.division] = [];
		grouped[f.division].push(f);
	}
	return grouped;
}
