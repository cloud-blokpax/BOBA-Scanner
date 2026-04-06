/**
 * Canonical eBay title/query builder for BoBA cards.
 *
 * Listing title format (80 char max):
 *   [Hero Name] - "Bo Jackson Battle Arena" - [Athlete Name] - [Parallel] - [Weapon]
 *
 * Truncation: drops the LAST field entirely if adding it would exceed 80 chars.
 * Never cuts a field in the middle — if a field doesn't fit, it and all lower-priority
 * fields are omitted.
 *
 * Search query tiers (see ebay-query.ts for server-side usage):
 *   1. Card Number (exact)
 *   2. Hero Name + Parallel + Weapon (exact)
 *   3. Athlete Name + Parallel + Weapon (exact)
 *   4. Fuzzy / broad
 */

const GAME_NAME = 'Bo Jackson Battle Arena';
const SEPARATOR = ' - ';

export interface EbayCardInfo {
	hero_name?: string | null;
	name?: string | null;
	athlete_name?: string | null;
	parallel?: string | null;
	weapon_type?: string | null;
	card_number?: string | null;
}

const SKIP_PARALLELS = new Set(['paper', 'base']);

function cleanParallel(parallel: string | null | undefined): string {
	const p = (parallel || '').trim();
	if (!p || SKIP_PARALLELS.has(p.toLowerCase())) return '';
	return p;
}

/**
 * Build the listing title parts in priority order.
 * Format: Hero Name, "Bo Jackson Battle Arena", Athlete Name, Parallel, Weapon
 */
function buildTitleParts(card: EbayCardInfo): string[] {
	const parts: string[] = [];

	const heroName = (card.hero_name || card.name || '').trim();
	if (heroName) parts.push(heroName);

	parts.push(GAME_NAME);

	const athlete = (card.athlete_name || '').trim();
	if (athlete) parts.push(athlete);

	const parallel = cleanParallel(card.parallel);
	if (parallel) parts.push(parallel);

	const weapon = (card.weapon_type || '').trim();
	if (weapon) parts.push(weapon);

	return parts;
}

/**
 * Build an eBay listing title (max 80 chars).
 *
 * Drops fields from the end (lowest priority) until the joined string fits.
 * Keeps at least Hero + "Bo Jackson Battle Arena".
 * Never truncates mid-field.
 */
export function buildEbayListingTitle(card: EbayCardInfo): string {
	const MAX_LENGTH = 80;
	const parts = buildTitleParts(card);

	// Try full title first
	let title = parts.join(SEPARATOR);
	if (title.length <= MAX_LENGTH) return title;

	// Drop from the end until it fits (keep at least Hero + Game Name)
	while (parts.length > 2 && title.length > MAX_LENGTH) {
		parts.pop();
		title = parts.join(SEPARATOR);
	}

	// Final safety: if even Hero + Game Name exceeds 80, hard-truncate
	if (title.length > MAX_LENGTH) {
		title = title.substring(0, MAX_LENGTH);
	}

	return title;
}

/**
 * Build a full eBay search query (no character limit).
 * Includes card number, hero, game name, athlete, parallel, weapon.
 */
export function buildEbaySearchQuery(card: EbayCardInfo): string {
	const parts: string[] = [];

	const heroName = (card.hero_name || card.name || '').trim();
	if (heroName) parts.push(heroName);

	parts.push(GAME_NAME);

	const athlete = (card.athlete_name || '').trim();
	if (athlete) parts.push(athlete);

	const parallel = cleanParallel(card.parallel);
	if (parallel) parts.push(parallel);

	const weapon = (card.weapon_type || '').trim();
	if (weapon) parts.push(weapon);

	const cardNum = (card.card_number || '').trim();
	if (cardNum) parts.push(cardNum);

	return parts.join(SEPARATOR);
}

/**
 * Build a concise eBay API query for Browse API searches.
 * Includes hero + game + athlete + card number (drops parallel/weapon for breadth).
 */
export function buildEbayApiQuery(card: EbayCardInfo): string {
	const parts: string[] = [];

	const heroName = (card.hero_name || card.name || '').trim();
	if (heroName) parts.push(heroName);

	parts.push(GAME_NAME);

	const athlete = (card.athlete_name || '').trim();
	if (athlete) parts.push(athlete);

	const cardNum = (card.card_number || '').trim();
	if (cardNum) parts.push(cardNum);

	return parts.join(SEPARATOR);
}
