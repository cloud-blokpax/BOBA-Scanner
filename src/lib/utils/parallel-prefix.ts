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
	Superfoil: 'Superfoil',

	// Sellers write "Alpha Blast" generically; color is encoded only in
	// card_number prefix (BL-B/BL-G/BL-S/BL-O/BL-P/BL-BG). Without these
	// mappings, the harvester searches the literal catalog parallel name
	// which never appears in seller titles. See Bug B harvester_parallel_health.
	'Blue Blast': 'Alpha Blast',
	'Green Blast': 'Alpha Blast',
	'Silver Blast': 'Alpha Blast',
	'Orange Blast': 'Alpha Blast',
	'Pink Blast': 'Alpha Blast',
	'Bubble Gum Blast': 'Alpha Blast',
	'Blast Inspired Ink': 'Alpha Blast',

	// Sellers write "Metallic" or "Metallic Foil" (not "Inspired Ink
	// Metallic Battlefoil"). Card_number prefix MBFA- differentiates from
	// other Inspired Ink families. Same fix shape as Blast.
	'Inspired Ink Metallic Battlefoil': 'Metallic',

	// Sellers write "Bubblegum" (one word) — confirmed via observation
	// sample (Donnie Shell DSA-2 "Bubblegum Inspired Ink").
	'Inspired Ink Bubble Gum Battlefoil': 'Bubblegum'
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
