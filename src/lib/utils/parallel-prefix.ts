/**
 * BoBA parallel → eBay-friendly short name mapping.
 *
 * Sellers and buyers use the parallel's familiar short form, not the canonical
 * catalog name. e.g. "Blizzard Battlefoil" is sold as "Blizzard"; "Headlines
 * Battlefoil" as "Headlines"; "80's Rad Battlefoil" as "RAD".
 *
 * Used by:
 *   - listing title generator (ebay-title.ts) — what we put on the seller's eBay listing
 *   - buyer search links (services/ebay.ts) — what we type into eBay search
 *   - harvester boolean query (server/ebay-query.ts) — what we feed to the Browse API
 *
 * Single source of truth. Do not duplicate this map.
 *
 * Paper is intentionally absent — handled by isPaperParallel(); never mapped.
 */
const PARALLEL_PREFIX_MAP: Record<string, string> = {
	// BoBA Battlefoil families — drop "Battlefoil" suffix
	"80's Rad Battlefoil": 'RAD',
	'Inspired Ink Battlefoil': 'Inspired Ink',
	'Inspired Ink Metallic Battlefoil': 'Inspired Ink Metallic',
	"Grandma's Linoleum Battlefoil": "Grandma's Linoleum",
	"Great Grandma's Linoleum Battlefoil": "Great Grandma's Linoleum",
	'Blizzard Battlefoil': 'Blizzard',
	'Bubblegum Battlefoil': 'Bubblegum',
	'Mixtape Battlefoil': 'Mixtape',
	'Miami Ice Battlefoil': 'Miami Ice',
	'Fire Tracks Battlefoil': 'Fire Tracks',
	'Power Glove Battlefoil': 'Power Glove',
	'Headlines Battlefoil': 'Headlines',
	'Blue Headlines Battlefoil': 'Blue Headlines',
	// Color Battlefoils
	'Blue Battlefoil': 'Blue',
	'Orange Battlefoil': 'Orange',
	'Pink Battlefoil': 'Pink',
	'Green Battlefoil': 'Green',
	'Silver Battlefoil': 'Silver',
	// No-suffix parallels stay as-is
	Superfoil: 'Superfoil'
};

const PAPER_VALUES = new Set(['paper', 'base']);

export function isPaperParallel(parallel: string | null | undefined): boolean {
	if (!parallel) return true;
	return PAPER_VALUES.has(parallel.trim().toLowerCase());
}

/**
 * Map a canonical BoBA parallel name to its eBay short form.
 *
 * Returns null for paper/base/empty — callers should omit the parallel field.
 * Returns the mapped value for known parallels.
 * Falls back to stripping a trailing " Battlefoil" for unmapped entries
 * (defensive — keeps new parallels behaving sensibly until added to the map).
 */
export function parallelPrefix(parallel: string | null | undefined): string | null {
	if (isPaperParallel(parallel)) return null;
	const trimmed = parallel!.trim();
	const mapped = PARALLEL_PREFIX_MAP[trimmed];
	if (mapped) return mapped;
	const stripped = trimmed.replace(/\s*Battlefoil\s*$/i, '').trim();
	return stripped || null;
}
