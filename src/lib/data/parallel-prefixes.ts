/**
 * Card Number Prefix <-> Parallel Mapping
 *
 * Every non-paper hero card has a letter prefix on its card_number
 * that identifies its parallel. Paper cards have no prefix (numeric only).
 *
 * This is the single source of truth for prefix/parallel relationships.
 * Used by the pack simulator to pull only real cards from the database.
 *
 * Prefix formats:
 * - Standard: PREFIX-NUMBER (e.g. BF-123, RAD-45)
 * - Compound: PREFIX-VARIANT-NUMBER (e.g. BL-B123, BL-BG45) — Alpha Blast colors
 * - Starter Kit: S-NUMBER/TOTAL (e.g. S-01/100)
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
	'BLBF': 'blizzard',
	'GLBF': 'grandmas_linoleum',
	'GGL': 'great_grandmas_linoleum',
	'MIX': 'mixtape',
	'MI': 'miami_ice',
	'FT': 'fire_tracks',
	'BGBF': 'bubblegum',
	'SL': 'slime',
	'CHILL': 'chillin',
	'GRILL': 'grillin',
	'LOGO': 'logo',
	'CBF': 'colosseum',
	'IBF': 'icon',
	'ABF': 'alpha',
	'PG': 'power_glove',
	'ALT': 'alt',

	// Headliners
	'HBF': 'headliner',
	'BHBF': 'blue_headliner',
	'OHBF': 'orange_headliner',
	'RHBF': 'red_headliner',

	// Standard Autographs (Inspired Ink)
	'BFA': 'inspired_ink',
	'BBFA': 'inspired_ink',       // Blue BF Autograph variant (same parallel)
	'MBFA': 'metallic_inspired_ink',

	// Athlete-Specific Autograph Prefixes (ALL map to inspired_ink)
	'AAA': 'inspired_ink', 'ABA': 'inspired_ink', 'ACA': 'inspired_ink',
	'ADPA': 'inspired_ink', 'ALTA': 'inspired_ink',
	'BGA': 'inspired_ink', 'BOJA': 'inspired_ink', 'BWA': 'inspired_ink',
	'CBA': 'inspired_ink', 'CFA': 'inspired_ink', 'CHMA': 'inspired_ink',
	'CMA': 'inspired_ink', 'CPRA': 'inspired_ink', 'CYBA': 'inspired_ink',
	'DEA': 'inspired_ink', 'DHA': 'inspired_ink', 'DMWA': 'inspired_ink',
	'DOA': 'inspired_ink', 'DPA': 'inspired_ink', 'DSA': 'inspired_ink',
	'EDDA': 'inspired_ink', 'EDLCA': 'inspired_ink',
	'EGA': 'inspired_ink', 'EMA': 'inspired_ink',
	'FFA': 'inspired_ink', 'FHA': 'inspired_ink',
	'GAA': 'inspired_ink', 'GBA': 'inspired_ink',
	'HLA': 'inspired_ink',
	'JAA': 'inspired_ink', 'JBA': 'inspired_ink', 'JBNA': 'inspired_ink',
	'JBOA': 'inspired_ink', 'JEA': 'inspired_ink', 'JHA': 'inspired_ink',
	'JKMA': 'inspired_ink', 'JLPA': 'inspired_ink', 'JPA': 'inspired_ink',
	'JRA': 'inspired_ink', 'JSA': 'inspired_ink', 'JSTA': 'inspired_ink',
	'KAA': 'inspired_ink', 'KGJA': 'inspired_ink', 'KGSA': 'inspired_ink',
	'KHA': 'inspired_ink',
	'MCA': 'inspired_ink', 'MRA': 'inspired_ink',
	'PBA': 'inspired_ink', 'PEA': 'inspired_ink', 'PGA': 'inspired_ink',
	'PMA': 'inspired_ink',
	'RCA': 'inspired_ink', 'RFA': 'inspired_ink', 'RJA': 'inspired_ink',
	'RQA': 'inspired_ink', 'RSA': 'inspired_ink', 'RYA': 'inspired_ink',
	'SFA': 'inspired_ink', 'SGA': 'inspired_ink', 'SKA': 'inspired_ink',
	'SMA': 'inspired_ink', 'SPA': 'inspired_ink', 'SRA': 'inspired_ink',
	'SSA': 'inspired_ink',
	'TAA': 'inspired_ink', 'TGA': 'inspired_ink', 'THA': 'inspired_ink',
	'THAA': 'inspired_ink', 'THRA': 'inspired_ink', 'TRA': 'inspired_ink',
	'VGSA': 'inspired_ink',

	// Superfoil
	'SF': 'super_parallel',

	// Sidekicks
	'CJ': 'cj_maddox',
	'BILLY': 'billy',

	// Other parallels
	'CYB': 'cyber',
	'RPU': 'rookie_power_up',
	'P': 'promo',
	'PIA': 'alt',                  // PIA-EP = Pet Dog Alt Inspired Ink Battlefoil

	// Alpha Blast Color Parallels (compound prefix with hyphen)
	'BL-B': 'blue_blast',
	'BL-BG': 'bubblegum_blast',
	'BL-G': 'green_blast',
	'BL-O': 'orange_blast',
	'BL-P': 'pink_blast',
	'BL-S': 'super_blast',
	'BL-SK': 'sidekick_blast',

	// World Champion Series (LA-1 through LA-38)
	'LA': 'world_champion',

	// Sandstorm Superfan Series (SSE-1 through SSE-29)
	'SSE': 'sandstorm',

	// Crossover / Sets (recognized but not pullable in standard pack sim)
	'BLC': 'blast_crossover',
	'S': 'starter_kit',
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
 * Compound prefixes sorted by length descending for longest-match-first lookup.
 * These are prefixes that contain a hyphen (e.g. BL-BG, BL-B).
 */
const COMPOUND_PREFIXES = Object.keys(PREFIX_TO_PARALLEL)
	.filter(k => k.includes('-'))
	.sort((a, b) => b.length - a.length);

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
	return prefixes.some(p => {
		// Compound prefixes (e.g., 'BL-B') already contain the hyphen
		if (p.includes('-')) {
			return upper.startsWith(p);
		}
		if (p === 'S') {
			// Starter Kit: S-01/100, S-101A, etc.
			return /^S-\d/i.test(upper);
		}
		return upper.startsWith(p + '-');
	});
}

/**
 * Extract the parallel key from a card_number's prefix.
 * Returns 'paper' for numeric-only, or the parallel key for prefixed cards.
 * Returns null if prefix is unrecognized.
 */
export function getParallelFromCardNumber(cardNumber: string): string | null {
	const trimmed = cardNumber.trim();
	if (isPaperCardNumber(trimmed)) return 'paper';

	const upper = trimmed.toUpperCase();

	// Check compound prefixes first (longest match wins)
	// e.g. BL-BG must match before BL-B
	for (const prefix of COMPOUND_PREFIXES) {
		if (upper.startsWith(prefix)) {
			return PREFIX_TO_PARALLEL[prefix];
		}
	}

	// Starter Kit: S-01/100, S-107/100, etc.
	if (/^S-\d/.test(upper)) return 'starter_kit';

	// Standard PREFIX-NUMBER format
	const match = upper.match(/^([A-Z]+)-/);
	if (!match) return null;

	return PREFIX_TO_PARALLEL[match[1]] || null;
}

/**
 * All known "bonus" parallel prefixes -- everything that is NOT paper and NOT standard BF.
 * Used by the pack sim to identify the bonus/insert pool.
 */
export const BONUS_PARALLEL_PREFIXES = Object.keys(PREFIX_TO_PARALLEL)
	.filter(p => p !== 'BF');
