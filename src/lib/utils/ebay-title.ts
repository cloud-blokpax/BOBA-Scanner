/**
 * Canonical eBay title/query builder for BoBA cards.
 *
 * Format: Hero Name - Bo Jackson Battle Arena - Athlete Name - Parallel - Weapon - Card Number
 * Priority (1=highest, drop from the end first):
 *   1. Hero Name
 *   2. "Bo Jackson Battle Arena"
 *   3. Athlete Name
 *   4. Parallel
 *   5. Weapon
 *   6. Card Number
 *
 * eBay listing titles: hard cap at 80 characters.
 * Search queries: no hard limit, but shorter is better.
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

/**
 * Build the full canonical eBay string for a card.
 * Returns all parts in priority order.
 */
function buildFullParts(card: EbayCardInfo): string[] {
	const parts: string[] = [];

	const heroName = (card.hero_name || card.name || '').trim();
	if (heroName) parts.push(heroName);

	parts.push(GAME_NAME);

	const athlete = (card.athlete_name || '').trim();
	if (athlete) parts.push(athlete);

	const parallel = (card.parallel || '').trim();
	if (parallel && parallel.toLowerCase() !== 'paper' && parallel.toLowerCase() !== 'base') {
		parts.push(parallel);
	}

	const weapon = (card.weapon_type || '').trim();
	if (weapon) parts.push(weapon);

	const cardNum = (card.card_number || '').trim();
	if (cardNum) parts.push(cardNum);

	return parts;
}

/**
 * Build an eBay listing title (max 80 chars).
 * Drops parts from the end (lowest priority) until it fits.
 */
export function buildEbayListingTitle(card: EbayCardInfo): string {
	const MAX_LENGTH = 80;
	const parts = buildFullParts(card);

	let title = parts.join(SEPARATOR);
	if (title.length <= MAX_LENGTH) return title;

	// Drop from the end until it fits (keep at least Hero + Game Name)
	while (parts.length > 2 && title.length > MAX_LENGTH) {
		parts.pop();
		title = parts.join(SEPARATOR);
	}

	if (title.length > MAX_LENGTH) {
		title = title.substring(0, MAX_LENGTH);
	}

	return title;
}

/**
 * Build an eBay search query (no character limit, but concise).
 * Includes all available parts for the best search results.
 */
export function buildEbaySearchQuery(card: EbayCardInfo): string {
	const parts = buildFullParts(card);
	return parts.join(SEPARATOR);
}

/**
 * Build a shorter eBay search query for API calls.
 * Drops weapon and parallel for broader results.
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
