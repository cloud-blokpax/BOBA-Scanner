/**
 * Card Number Prefix <-> Parallel Mapping
 *
 * Every non-paper hero card has a letter prefix on its card_number
 * that identifies its parallel. Paper cards have no prefix (numeric only).
 *
 * This is the single source of truth for prefix/parallel relationships.
 * Used by the pack simulator to pull only real cards from the database.
 */

/** Map from card_number prefix -> parallel key (matching boba-parallels.ts) */
export const PREFIX_TO_PARALLEL: Record<string, string> = {
	// Standard Battlefoil
	'BF': 'battlefoil',

	// Color Battlefoils
	'SBF': 'silver',
	'BBF': 'blue_battlefoil',
	'OBF': 'orange_battlefoil',
	'GBF': 'green_battlefoil',
	'PBF': 'pink_battlefoil',
	'RBF': 'red_battlefoil',

	// Named Inserts
	'RAD': '80s_rad',
	'BL': 'blizzard',
	'BLBF': 'blizzard',
	'GLBF': 'grandmas_linoleum',
	'GGL': 'great_grandmas_linoleum',
	'HD': 'headlines',
	'RHBF': 'red_headlines',
	'OHBF': 'orange_headlines',
	'HBF': 'blue_headlines',
	'MIX': 'mixtape',
	'MI': 'miami_ice',
	'FT': 'fire_tracks',
	'BGBF': 'bubblegum',
	'SL': 'slime',
	'CHILL': 'chillin',
	'CJ': 'grillin',
	'LOGO': 'logo',
	'CBF': 'colosseum',
	'IBF': 'icon',
	'ABF': 'alpha',
	'PG': 'power_glove',
	'ALT': 'alt',

	// Autographs / Inspired Ink
	'BFA': 'inspired_ink',
	'BBFA': 'inspired_ink',
	'MBFA': 'metallic_inspired_ink',

	// Superfoil
	'SF': 'super_parallel',
};

/** Map from parallel key -> list of valid card_number prefixes */
export const PARALLEL_TO_PREFIXES: Record<string, string[]> = {};

// Build the reverse mapping
for (const [prefix, parallel] of Object.entries(PREFIX_TO_PARALLEL)) {
	if (!PARALLEL_TO_PREFIXES[parallel]) {
		PARALLEL_TO_PREFIXES[parallel] = [];
	}
	PARALLEL_TO_PREFIXES[parallel].push(prefix);
}

// Add special entries
PARALLEL_TO_PREFIXES['paper'] = [];  // Paper = no prefix (numeric only)

/**
 * Determine if a card_number is "paper" (no letter prefix, numeric only).
 */
export function isPaperCardNumber(cardNumber: string): boolean {
	return /^\d+$/.test(cardNumber.trim());
}

/**
 * Determine if a card_number is standard Battlefoil (BF- prefix only).
 */
export function isBattlefoilCardNumber(cardNumber: string): boolean {
	return /^BF-\d+$/i.test(cardNumber.trim());
}

/**
 * Determine if a card_number matches a specific parallel via its prefix.
 */
export function cardMatchesParallel(cardNumber: string, parallelKey: string): boolean {
	if (parallelKey === 'paper') return isPaperCardNumber(cardNumber);
	if (parallelKey === 'battlefoil') return isBattlefoilCardNumber(cardNumber);

	const prefixes = PARALLEL_TO_PREFIXES[parallelKey];
	if (!prefixes || prefixes.length === 0) return false;

	const upper = cardNumber.toUpperCase().trim();
	return prefixes.some(p => upper.startsWith(p + '-'));
}

/**
 * Extract the parallel key from a card_number's prefix.
 * Returns 'paper' for numeric-only, or the parallel key for prefixed cards.
 * Returns null if prefix is unrecognized.
 */
export function getParallelFromCardNumber(cardNumber: string): string | null {
	const trimmed = cardNumber.trim();
	if (isPaperCardNumber(trimmed)) return 'paper';

	const match = trimmed.match(/^([A-Z]+)-/i);
	if (!match) return null;

	const prefix = match[1].toUpperCase();
	return PREFIX_TO_PARALLEL[prefix] || null;
}

/**
 * All known "bonus" parallel prefixes -- everything that is NOT paper and NOT standard BF.
 * Used by the pack sim to identify the bonus/insert pool.
 */
export const BONUS_PARALLEL_PREFIXES = Object.keys(PREFIX_TO_PARALLEL)
	.filter(p => p !== 'BF');
