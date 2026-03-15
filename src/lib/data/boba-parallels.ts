/**
 * BoBA Card Parallel / Treatment Taxonomy
 *
 * Parallels (also called "treatments" or "inserts") are cosmetic variants of cards.
 * In Apex Madness format, having 10+ of a single Insert type in your Core Deck
 * unlocks 1 Apex card of that Insert type (max 6 unlocked this way).
 */

export interface ParallelType {
	/** Display name as it appears on cards and in the database */
	name: string;
	/** Lowercase key for matching against card.parallel field */
	key: string;
	/** Whether this is a Battlefoil (holographic foil treatment) */
	isBattlefoil: boolean;
	/** Whether this counts as a distinct "Insert type" for Madness unlock purposes */
	isMadnessInsert: boolean;
	/** Whether this is the wild card (counts as any Insert type in Madness) */
	isWild: boolean;
	/** Which weapon types this parallel appears in (empty = all weapons) */
	restrictedToWeapons: string[];
	/** Which box types this is found in (for collector reference) */
	foundIn: string[];
	/** Short description for UI display */
	description: string;
	/** Serialization (e.g., "/10" means only 10 copies exist). null = unlimited */
	serialization: string | null;
}

export const PARALLEL_TYPES: ParallelType[] = [
	// --- Base treatments ---
	{ name: 'Base Paper', key: 'base', isBattlefoil: false, isMadnessInsert: false, isWild: false, restrictedToWeapons: [], foundIn: ['all'], description: 'Standard non-foil card', serialization: null },
	{ name: 'Base Foil', key: 'foil', isBattlefoil: true, isMadnessInsert: false, isWild: false, restrictedToWeapons: [], foundIn: ['all'], description: 'Standard foil treatment', serialization: null },

	// --- Color Battlefoils (each is a separate Insert type for Madness) ---
	{ name: 'Silver Battlefoil', key: 'silver', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: ['steel'], foundIn: ['hobby', 'jumbo'], description: 'Silver foil, Steel weapon only', serialization: null },
	{ name: 'Blue Battlefoil', key: 'blue_battlefoil', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: ['ice'], foundIn: ['hobby', 'jumbo'], description: 'Blue foil, Ice weapon only', serialization: null },
	{ name: 'Orange Battlefoil', key: 'orange_battlefoil', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: ['fire'], foundIn: ['hobby', 'jumbo'], description: 'Orange foil, Fire weapon only', serialization: null },
	{ name: 'Green Battlefoil', key: 'green_battlefoil', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'jumbo'], description: 'Green foil', serialization: null },
	{ name: 'Pink Battlefoil', key: 'pink_battlefoil', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'jumbo'], description: 'Pink foil', serialization: null },
	{ name: 'Red Battlefoil', key: 'red_battlefoil', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'jumbo'], description: 'Red foil, Hobby/Jumbo exclusive', serialization: null },

	// --- Named inserts (all count as separate Insert types for Madness) ---
	{ name: 'Blizzard', key: 'blizzard', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'collector'], description: 'Ice/snow themed foil insert', serialization: null },
	{ name: '80s Rad', key: '80s_rad', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'collector'], description: '1980s retro neon themed insert', serialization: null },
	{ name: "Grandma's Linoleum", key: 'grandmas_linoleum', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'collector'], description: 'Green vintage pattern insert', serialization: null },
	{ name: "Great Grandma's Linoleum", key: 'great_grandmas_linoleum', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['collector'], description: 'Red vintage pattern insert', serialization: null },
	{ name: 'Headlines', key: 'headlines', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: ['steel', 'fire', 'ice', 'brawl'], foundIn: ['hobby', 'collector'], description: 'Newspaper headline themed insert', serialization: null },
	{ name: 'Icon', key: 'icon', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['collector'], description: 'Iconic athlete pose insert', serialization: null },
	{ name: 'Colosseum', key: 'colosseum', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['collector'], description: 'Arena/colosseum themed insert', serialization: null },
	{ name: 'Logo', key: 'logo', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby'], description: 'BoBA logo themed foil', serialization: null },
	{ name: 'Mixtape', key: 'mixtape', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'collector'], description: 'Cassette tape themed insert', serialization: null },
	{ name: 'Miami Ice', key: 'miami_ice', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['collector'], description: 'Miami Vice inspired neon insert', serialization: null },
	{ name: 'Fire Tracks', key: 'fire_tracks', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'collector'], description: 'Flame trail themed insert', serialization: null },
	{ name: 'Bubblegum', key: 'bubblegum', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'collector'], description: 'Pink bubblegum themed insert', serialization: null },
	{ name: 'Grillin', key: 'grillin', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby'], description: 'BBQ/grill themed insert', serialization: null },
	{ name: 'Chillin', key: 'chillin', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby'], description: 'Relaxed/cool themed insert', serialization: null },
	{ name: 'Slime', key: 'slime', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['hobby', 'collector'], description: 'Green slime themed insert', serialization: null },
	{ name: 'Alpha', key: 'alpha', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['alpha_edition'], description: 'Original Alpha Edition battlefoil', serialization: null },
	{ name: 'Power Glove', key: 'power_glove', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['2026_edition'], description: '2026 Edition power glove themed insert', serialization: null },

	// --- Special treatments ---
	{ name: 'Inspired Ink', key: 'inspired_ink', isBattlefoil: true, isMadnessInsert: true, isWild: false, restrictedToWeapons: [], foundIn: ['collector'], description: 'On-card autograph (not sticker), available across weapon tiers', serialization: '/10' },
	{ name: 'Super', key: 'super_parallel', isBattlefoil: true, isMadnessInsert: true, isWild: true, restrictedToWeapons: ['super'], foundIn: ['collector'], description: '1/1 Superfoil, WILD for Madness (counts as any Insert type)', serialization: null },
];

/** Get a parallel type by key (case-insensitive, fuzzy) */
export function getParallel(key: string): ParallelType | undefined {
	const normalized = key.toLowerCase().trim().replace(/['']/g, "'");
	return PARALLEL_TYPES.find(p =>
		p.key === normalized ||
		p.name.toLowerCase() === normalized ||
		p.name.toLowerCase().replace(/['']/g, "'") === normalized
	);
}

/** Get all Insert types that count for Madness unlock purposes */
export function getMadnessInsertTypes(): ParallelType[] {
	return PARALLEL_TYPES.filter(p => p.isMadnessInsert);
}

/** Check if a parallel is the wild card (Super) */
export function isWildParallel(key: string): boolean {
	return getParallel(key)?.isWild ?? false;
}
