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
 *   1. Hero Name + Parallel (most common path)
 *   2. Athlete Name + Parallel
 *   3. Card Number prefix (inherently parallel-specific)
 *   4. Broad hero/athlete match with parallel gate
 */

const GAME_NAME = 'Bo Jackson Battle Arena';
const WONDERS_GAME_NAME = 'Wonders of The First';
const WONDERS_GAME_SHORT = 'WoTF';
const SEPARATOR = ' - ';

export interface EbayCardInfo {
	hero_name?: string | null;
	name?: string | null;
	athlete_name?: string | null;
	/** Human-readable parallel name from cards.parallel (e.g. "Battlefoil",
	 *  "Classic Foil"). Mirrors the DB. Used for title and search keywords. */
	parallel?: string | null;
	weapon_type?: string | null;
	card_number?: string | null;
	/** Phase 2.5: routes title/query builders to the right game format. */
	game_id?: string | null;
	/** Phase 2.5: Wonders-only, for title context. Falls back silently if missing. */
	metadata?: Record<string, unknown> | null;
}

const SKIP_PARALLELS = new Set(['paper', 'base']);

// ── Wonders parallel name mapping ─────────────────────────────
// Maps short codes (legacy) AND human-readable DB names to the title-form
// string. Long-form names win searches — buyers type "Orbital Color Match",
// not "ocm".
const WONDERS_PARALLEL_TITLE: Record<string, string> = {
	'paper': '',                    // omit entirely
	'classic foil': 'Classic Foil',
	'formless foil': 'Formless Foil',
	'orbital color match': 'Orbital Color Match',
	'stonefoil': 'Stonefoil',
	// Legacy short-code aliases
	'cf': 'Classic Foil',
	'ff': 'Formless Foil',
	'ocm': 'Orbital Color Match',
	'sf': 'Stonefoil',
};

function wondersParallelTitle(parallel: string | null | undefined): string {
	if (!parallel) return '';
	return WONDERS_PARALLEL_TITLE[parallel.toLowerCase()] ?? '';
}

function wondersSetDisplay(metadata: Record<string, unknown> | null | undefined): string {
	if (!metadata) return '';
	const raw = metadata.set_name_display ?? metadata.set_name;
	return typeof raw === 'string' ? raw.trim() : '';
}

function wondersCardName(card: EbayCardInfo): string {
	// For Wonders, card.name is the card name. hero_name may be aliased via the
	// scan endpoint but name is canonical for Wonders printings.
	return (card.name || card.hero_name || '').trim();
}

function cleanParallel(parallel: string | null | undefined): string {
	const p = (parallel || '').trim();
	if (!p || SKIP_PARALLELS.has(p.toLowerCase())) return '';
	return p;
}

/**
 * Build the listing title parts in priority order.
 * Format: Hero Name, "Bo Jackson Battle Arena", Athlete Name, Parallel, Weapon, Card Number
 *
 * Card Number is lowest priority — dropped first during truncation.
 * This matches the canonical eBay title format documented in CLAUDE.md.
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

	const cardNum = (card.card_number || '').trim();
	if (cardNum) parts.push(cardNum);

	return parts;
}

/**
 * Build an eBay listing title (max 80 chars).
 *
 * Drops fields from the end (lowest priority) until the joined string fits.
 * Dispatches on card.game_id — Wonders uses a different format and truncation
 * priority from BoBA.
 */
export function buildEbayListingTitle(card: EbayCardInfo): string {
	if ((card.game_id || 'boba') === 'wonders') {
		return buildWondersListingTitle(card);
	}
	return buildBobaListingTitle(card);
}

function buildBobaListingTitle(card: EbayCardInfo): string {
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
 * Wonders listing title format:
 *   {Card Name} - Wonders of The First - {Set Display} - {Variant} - {Collector Number}
 *
 * Example:
 *   "Riley Stormrider - Wonders of The First - Call of the Stones - Orbital Color Match - A1-205/402"
 *
 * Truncation priority (drop in this order when title exceeds 80 chars):
 *   1. Set display name — recoverable from the collector number prefix (e.g. CLA-)
 *   2. Variant full name — painful to drop, try hard to keep
 *   3. "Wonders of The First" becomes "WoTF" as a last resort
 * Never drop the card name or collector number.
 *
 * Paper variant is omitted from the title by design — buyers searching for the
 * base printing typically do NOT type "Paper", so including it harms matching.
 */
function buildWondersListingTitle(card: EbayCardInfo): string {
	const MAX_LENGTH = 80;
	const cardName = wondersCardName(card);
	const setDisplay = wondersSetDisplay(card.metadata);
	const parallelName = wondersParallelTitle(card.parallel);
	const cardNumber = (card.card_number || '').trim();

	const assemble = (
		name: string,
		gameName: string,
		set: string,
		parallel: string,
		number: string,
	): string => {
		const out: string[] = [];
		if (name) out.push(name);
		if (gameName) out.push(gameName);
		if (set) out.push(set);
		if (parallel) out.push(parallel);
		if (number) out.push(number);
		return out.join(SEPARATOR);
	};

	// Full form first
	let title = assemble(cardName, WONDERS_GAME_NAME, setDisplay, parallelName, cardNumber);
	if (title.length <= MAX_LENGTH) return title;

	// Step 1: drop set display name
	title = assemble(cardName, WONDERS_GAME_NAME, '', parallelName, cardNumber);
	if (title.length <= MAX_LENGTH) return title;

	// Step 2: drop parallel (most painful — only if still over limit)
	title = assemble(cardName, WONDERS_GAME_NAME, '', '', cardNumber);
	if (title.length <= MAX_LENGTH) return title;

	// Step 3: shorten "Wonders of The First" → "WoTF"
	title = assemble(cardName, WONDERS_GAME_SHORT, '', '', cardNumber);
	if (title.length <= MAX_LENGTH) return title;

	// Final safety: hard truncate (should almost never happen — card name + "WoTF" +
	// collector number fits in 80 chars for every real Wonders printing).
	return title.substring(0, MAX_LENGTH);
}

/**
 * Build a full eBay search query (no character limit).
 * Dispatches on game_id. BoBA includes hero/athlete/weapon/parallel/card_number;
 * Wonders includes card name / game name / variant / collector number.
 */
export function buildEbaySearchQuery(card: EbayCardInfo): string {
	if ((card.game_id || 'boba') === 'wonders') {
		const parts: string[] = [];
		const name = wondersCardName(card);
		if (name) parts.push(name);
		parts.push(WONDERS_GAME_NAME);
		const setDisplay = wondersSetDisplay(card.metadata);
		if (setDisplay) parts.push(setDisplay);
		const parallelName = wondersParallelTitle(card.parallel);
		if (parallelName) parts.push(parallelName);
		const cardNum = (card.card_number || '').trim();
		if (cardNum) parts.push(cardNum);
		return parts.join(SEPARATOR);
	}

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
 *
 * BoBA: Hero Name - "Bo Jackson Battle Arena" - [Parallel] - [Weapon]
 * Wonders: Card Name - "Wonders of The First" - [Variant Long Name]
 *
 * Card number is intentionally excluded so the search stays broad — the
 * server-side filterRelevantListings checks collector number post-fetch.
 */
export function buildEbayApiQuery(card: EbayCardInfo): string {
	if ((card.game_id || 'boba') === 'wonders') {
		const parts: string[] = [];
		const name = wondersCardName(card);
		if (name) parts.push(name);
		parts.push(WONDERS_GAME_NAME);
		const parallelName = wondersParallelTitle(card.parallel);
		if (parallelName) parts.push(parallelName);
		return parts.join(SEPARATOR);
	}

	const parts: string[] = [];

	// 1. Hero Name — strongest identifier
	const heroName = (card.hero_name || card.name || '').trim();
	if (heroName) parts.push(heroName);

	// 2. Game Name — required BoBA context
	parts.push(GAME_NAME);

	// 3. Parallel — critical price differentiator (skip paper/base)
	const parallel = cleanParallel(card.parallel);
	if (parallel) parts.push(parallel);

	// 4. Weapon — narrows within a parallel
	const weapon = (card.weapon_type || '').trim();
	if (weapon) parts.push(weapon);

	return parts.join(SEPARATOR);
}
