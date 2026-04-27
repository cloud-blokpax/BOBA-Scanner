/**
 * Server-side eBay search query builder and result filter for BoBA cards.
 *
 * Every server-side path that searches eBay for card prices MUST use this.
 *
 * Query shape (boolean OR-grouped, validated against ~40 real seller titles):
 *
 *   (hero_name, athlete_name) "Bo Jackson Battle Arena" (card_number, "parallel_prefix")
 *
 * Translation:
 *   - (hero, athlete) — at least one identity match
 *   - "Bo Jackson Battle Arena" — set anchor (always)
 *   - (card_number, "parallel_prefix") — at least one discriminator
 *
 * eBay query syntax notes:
 *   - Space between tokens = AND
 *   - (a, b) = OR
 *   - Quoted strings = phrase match
 *   - 350 char hard limit on q=
 *   - Compound arms inside an OR group like (a, "b" c) are NOT supported by
 *     eBay Browse API — production tested 2026-04-27. The earlier v3 form
 *     `(card#, "parallel" weapon)` collapsed recall (50% zero-result rate,
 *     10× drop in raw results) because eBay parsed the weapon as an AND
 *     across the whole query. Weapon stays in the post-fetch filter only.
 */

import { buildEbayApiQuery } from '$lib/utils/ebay-title';
import type { EbayCardInfo } from '$lib/utils/ebay-title';

export type { EbayCardInfo as EbayQueryCard };

const EBAY_Q_MAX = 340;

/**
 * BoBA parallel → search-prefix mapping.
 *
 * Sellers list cards under the parallel's familiar short form, not the
 * canonical catalog name. e.g. "Headlines Battlefoil" is sold as just
 * "Headlines"; "80's Rad Battlefoil" is sold as "RAD".
 *
 * The Battlefoil-family entries strip the trailing " Battlefoil" suffix.
 * Color Battlefoils (Blue/Orange/etc.) drop the suffix entirely. Cards with
 * no shared family (e.g. plain "Superfoil") stay as-is.
 *
 * Paper is handled by isPaper() — never mapped here.
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

function quoteIfMultiWord(value: string): string {
	return value.includes(' ') ? `"${value}"` : value;
}

function isPaper(parallel: string | null | undefined): boolean {
	if (!parallel) return true;
	return parallel.trim().toLowerCase() === 'paper';
}

function parallelPrefix(parallel: string | null | undefined): string | null {
	if (isPaper(parallel)) return null;
	const trimmed = parallel!.trim();
	const mapped = PARALLEL_PREFIX_MAP[trimmed];
	if (mapped) return mapped;
	// Fallback: strip trailing " Battlefoil"
	const stripped = trimmed.replace(/\s*Battlefoil\s*$/i, '').trim();
	return stripped || null;
}

/**
 * Build the BoBA boolean eBay search query.
 *
 *   (hero, athlete) "Bo Jackson Battle Arena" (card_number, "parallel_prefix")
 *
 * Construction rules:
 *   - Hero/athlete OR group: include both arms when both exist and differ;
 *     otherwise emit the single arm bare.
 *   - Anchor "Bo Jackson Battle Arena": always quoted phrase, always present.
 *   - Discriminator OR group: (card_number, "parallel_prefix").
 *     If only card_number → emit bare card_number.
 *     If only the parallel arm → emit it bare.
 *     If neither → discriminator dropped entirely.
 *   - Weapon is intentionally NOT in the query (post-fetch filter only).
 *     See module header comment for the production data behind this.
 *
 * Length guard: drops the discriminator group if the joined query exceeds
 * EBAY_Q_MAX (340 chars).
 */
export function buildEbayQuery(card: EbayCardInfo): string {
	const tokens: string[] = [];

	// Group 1: (hero_name, athlete_name)
	const hero = (card.hero_name || card.name || '').trim();
	const athlete = (card.athlete_name || '').trim();
	const heroArm = hero ? quoteIfMultiWord(hero) : '';
	const athleteArm =
		athlete && athlete.toLowerCase() !== hero.toLowerCase() ? quoteIfMultiWord(athlete) : '';

	if (heroArm && athleteArm) {
		tokens.push(`(${heroArm}, ${athleteArm})`);
	} else if (heroArm) {
		tokens.push(heroArm);
	} else if (athleteArm) {
		tokens.push(athleteArm);
	}

	// Set anchor (always)
	tokens.push('"Bo Jackson Battle Arena"');

	// Group 2: (card_number, "parallel_prefix")
	const cardNumber = (card.card_number || '').trim();
	const prefix = parallelPrefix(card.parallel);

	const arm1 = cardNumber;
	const arm2 = prefix ? quoteIfMultiWord(prefix) : '';

	if (arm1 && arm2) {
		tokens.push(`(${arm1}, ${arm2})`);
	} else if (arm1) {
		tokens.push(arm1);
	} else if (arm2) {
		tokens.push(arm2);
	}

	let query = tokens.join(' ');
	if (query.length > EBAY_Q_MAX && tokens.length === 3) {
		tokens.pop();
		query = tokens.join(' ');
	}

	return query;
}

/**
 * Build the eBay Browse API search query for a card.
 *
 * BoBA → boolean OR-grouped query (see buildEbayQuery).
 * Wonders → falls through to the legacy `buildEbayApiQuery` from ebay-title.ts;
 * Wonders price harvest paths use `buildWondersEbayQuery` directly and don't
 * call this function.
 */
export function buildEbaySearchQuery(card: EbayCardInfo): string {
	if ((card.game_id || 'boba') === 'wonders') {
		return buildEbayApiQuery(card);
	}
	return buildEbayQuery(card);
}

// ── Result filter ───────────────────────────────────────────

/**
 * Title patterns that hard-reject a listing regardless of identity match.
 * Categories observed in real eBay search contamination: graded slabs,
 * sealed product, lots/multi-card sets, and vintage Bo Jackson memorabilia
 * that pre-dates the BoBA TCG (Topps/Fleer/Donruss/etc).
 */
const TITLE_REJECT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	// Graded — route to a separate bucket later. Drop from raw median for now.
	{ name: 'graded', pattern: /\b(psa|bgs|sgc|cgc|tag)\s*\d/i },
	{ name: 'graded_word', pattern: /\b(graded|slabbed|slab)\b/i },
	// Sealed product
	{ name: 'sealed_box', pattern: /\b(blaster|mega|hobby|jumbo)\s*box\b/i },
	{
		name: 'sealed_keyword',
		pattern: /\b(sealed|trainer kit|booster pack|factory sealed|launch day bundle)\b/i
	},
	{ name: 'pack', pattern: /\bjumbo\s*pack\b/i },
	// Lots / multiples / sets
	{ name: 'lot_of', pattern: /\blot\s*of\b/i },
	{ name: 'complete_set', pattern: /\bcomplete\s+(set|your\s+(set|paper|hero))\b/i },
	{ name: 'bundle', pattern: /\b(bundle|set\s+deck)\b/i },
	{ name: 'multi_count', pattern: /\b\d+\s*(cards|card\s+lot|x\s*\d+)\b/i },
	// Vintage Bo Jackson memorabilia (not BoBA)
	{ name: 'vintage_brand', pattern: /\b(topps|fleer|donruss|score|upper deck|panini)\b/i },
	{
		name: 'vintage_misc',
		pattern: /\b(starting lineup|bobblehead|bat break|jersey|helmet|figure|action figure)\b/i
	},
	{ name: 'vintage_team', pattern: /\b(royals|raiders|auburn|white sox|memphis chicks)\b/i }
];

const ALL_WEAPONS = ['steel', 'fire', 'ice', 'hex', 'brawl', 'super', 'gum', 'glow'];

/**
 * If the title mentions a weapon AND that weapon is not the catalog weapon
 * for this card, treat it as a different printing (e.g. Bojax-Ice listing
 * vs catalog Bojax-Fire). Drops it from the raw bucket.
 *
 * Returns false (no conflict) when the card has no catalog weapon, or when
 * the title mentions only the catalog weapon, or no weapon at all.
 */
function weaponConflicts(title: string, cardWeapon: string | null | undefined): boolean {
	if (!cardWeapon) return false;
	const cardW = cardWeapon.toLowerCase();
	const otherWeaponsInTitle = ALL_WEAPONS.filter(
		(w) => w !== cardW && new RegExp(`\\b${w}\\b`, 'i').test(title)
	);
	if (otherWeaponsInTitle.length === 0) return false;
	const cardWeaponInTitle = new RegExp(`\\b${cardW}\\b`, 'i').test(title);
	return !cardWeaponInTitle;
}

/**
 * Decision emitted by `evaluateListings` for each raw eBay item.
 * `accepted=true` means the listing passed every gate; `rejection_reason`
 * is the name of the gate that dropped it (or null on accept).
 */
export type ListingFilterDecision = {
	accepted: boolean;
	rejection_reason: string | null;
	weapon_conflict: boolean;
};

/**
 * Evaluate every raw eBay item against the same gates `filterRelevantListings`
 * applies, but return a decision for every item instead of dropping rejects.
 * Powers the harvester's per-listing observation table — we want the rejected
 * listings persisted alongside the accepted ones with the rejection reason
 * tagged on each row.
 */
export function evaluateListings<T extends { title?: string }>(
	items: T[],
	card: EbayCardInfo
): Array<{ item: T; decision: ListingFilterDecision }> {
	const heroStr = (card.hero_name || card.name || '').toUpperCase().trim();
	const athleteStr = (card.athlete_name || '').toUpperCase().trim();
	const parallelStr = (card.parallel || '').toUpperCase().trim();
	const prefixStr = (parallelPrefix(card.parallel) || '').toUpperCase().trim();
	const cardNum = (card.card_number || '').toUpperCase();
	const normalizedCardNum = cardNum.replace(/[-\s]/g, '');
	const hasParallel = parallelStr && parallelStr !== 'PAPER' && parallelStr !== 'BASE';

	const matchesParallel = (titleUpper: string): boolean => {
		if (!hasParallel) return true;
		if (titleUpper.includes(parallelStr)) return true;
		if (prefixStr && titleUpper.includes(prefixStr)) return true;
		return false;
	};

	const heroLc = heroStr.toLowerCase();
	const athleteLc = athleteStr.toLowerCase();
	const normalizedCardNumLc = normalizedCardNum.toLowerCase();

	return items.map((item) => {
		const title = item.title || '';
		if (!title) {
			return {
				item,
				decision: { accepted: false, rejection_reason: 'missing_title', weapon_conflict: false }
			};
		}

		// 1. Hard rejects
		for (const r of TITLE_REJECT_PATTERNS) {
			if (r.pattern.test(title)) {
				return {
					item,
					decision: {
						accepted: false,
						rejection_reason: `hard_reject:${r.name}`,
						weapon_conflict: false
					}
				};
			}
		}

		const titleLc = title.toLowerCase();
		const titleUpper = title.toUpperCase();

		// 2. Set anchor
		if (!titleLc.includes('battle arena')) {
			return {
				item,
				decision: { accepted: false, rejection_reason: 'set_anchor', weapon_conflict: false }
			};
		}

		// 3. Identity gate — at least one of hero / athlete / card_number
		const heroMatch = heroLc.length > 2 && includesAllWords(titleLc, heroLc);
		const athleteMatch = athleteLc.length > 2 && includesAllWords(titleLc, athleteLc);
		const cardNumMatch =
			normalizedCardNumLc.length > 2 &&
			titleLc.replace(/[-\s]/g, '').includes(normalizedCardNumLc);
		if (!heroMatch && !athleteMatch && !cardNumMatch) {
			return {
				item,
				decision: { accepted: false, rejection_reason: 'identity_gate', weapon_conflict: false }
			};
		}

		// 4. Weapon disambiguation
		const wConflict = weaponConflicts(title, card.weapon_type ?? null);
		if (wConflict) {
			return {
				item,
				decision: {
					accepted: false,
					rejection_reason: 'weapon_conflict',
					weapon_conflict: true
				}
			};
		}

		// 5. Parallel gate
		if (!matchesParallel(titleUpper)) {
			return {
				item,
				decision: { accepted: false, rejection_reason: 'parallel_gate', weapon_conflict: false }
			};
		}

		return {
			item,
			decision: { accepted: true, rejection_reason: null, weapon_conflict: false }
		};
	});
}

/**
 * Filter eBay item summaries to those matching a specific card.
 *
 * Hardened pipeline:
 *   1. Hard rejects (TITLE_REJECT_PATTERNS): graded, sealed, lots, vintage.
 *   2. Set anchor: title must contain "battle arena".
 *   3. Identity gate: title must mention hero OR athlete OR card number.
 *   4. Weapon disambiguation: drop listings that mention a different weapon.
 *   5. Parallel gate (when card has a non-paper parallel): title must
 *      include the parallel name OR its short search prefix.
 *
 * Implemented as a thin wrapper over `evaluateListings` so the gate logic has
 * exactly one source of truth.
 */
export function filterRelevantListings<T extends { title?: string }>(
	items: T[],
	card: EbayCardInfo
): T[] {
	return evaluateListings(items, card)
		.filter((d) => d.decision.accepted)
		.map((d) => d.item);
}

/**
 * Check if a title string contains all words from a name.
 * "deandre hopkins" matches a title containing both "deandre" and "hopkins".
 */
function includesAllWords(title: string, name: string): boolean {
	const words = name.split(/\s+/).filter((w) => w.length > 1);
	return words.length > 0 && words.every((w) => title.includes(w));
}
