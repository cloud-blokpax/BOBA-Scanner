/**
 * Unit tests for the BoBA eBay search query builder and post-fetch filter.
 *
 * The query builder produces a boolean OR-grouped expression validated against
 * ~40 real seller titles harvested from live eBay search:
 *   (hero, athlete) "Bo Jackson Battle Arena" (card_number, "parallel_prefix")
 *
 * Weapon is intentionally absent from the query — eBay treats compound OR-arms
 * `(a, "b" c)` as AND-required across the whole query, which collapsed recall
 * in production. Weapon stays in the post-fetch filter only.
 *
 * The filter rejects graded slabs, sealed product, lots, and vintage Bo
 * Jackson memorabilia, then enforces an identity gate (hero/athlete/card#),
 * a weapon-disambiguation rule, and a parallel gate.
 */
import { describe, it, expect } from 'vitest';
import { buildEbayQuery, filterRelevantListings } from '../src/lib/server/ebay-query';
import type { EbayQueryCard } from '../src/lib/server/ebay-query';

describe('buildEbayQuery — BoBA OR-grouped boolean', () => {
	it('builds full form with hero + athlete + card_number + parallel + weapon', () => {
		const q = buildEbayQuery({
			hero_name: 'Lady Magic',
			name: 'Lady Magic',
			parallel: "Grandma's Linoleum Battlefoil",
			weapon_type: 'Hex',
			athlete_name: 'Nancy Lieberman',
			card_number: 'GLBF-27'
		});
		expect(q).toBe(
			`("Lady Magic", "Nancy Lieberman") "Bo Jackson Battle Arena" (GLBF-27, "Grandma's Linoleum")`
		);
	});

	it('shortens "80\'s Rad Battlefoil" to RAD via the prefix map', () => {
		const q = buildEbayQuery({
			hero_name: 'Bandelero',
			name: 'Bandelero',
			parallel: "80's Rad Battlefoil",
			weapon_type: 'Hex',
			athlete_name: 'Paolo Banchero',
			card_number: 'RAD-266'
		});
		expect(q).toBe(`(Bandelero, "Paolo Banchero") "Bo Jackson Battle Arena" (RAD-266, RAD)`);
	});

	it('omits athlete arm when hero matches athlete (Bojax = Bo Jackson)', () => {
		const q = buildEbayQuery({
			hero_name: 'Bojax',
			name: 'Bojax',
			parallel: 'Blue Battlefoil',
			weapon_type: 'Ice',
			athlete_name: null,
			card_number: 'BBF-1'
		});
		expect(q).toBe(`Bojax "Bo Jackson Battle Arena" (BBF-1, Blue)`);
	});

	it('drops the parallel arm for paper cards (discriminator collapses to card_number)', () => {
		const q = buildEbayQuery({
			hero_name: 'Time',
			name: 'Time',
			parallel: 'Paper',
			weapon_type: 'Fire',
			athlete_name: 'Damian Lillard',
			card_number: '94'
		});
		expect(q).toBe(`(Time, "Damian Lillard") "Bo Jackson Battle Arena" 94`);
	});

	it('emits arm2 bare when card_number is missing', () => {
		const q = buildEbayQuery({
			hero_name: 'Showtime',
			name: 'Showtime',
			parallel: 'Headlines Battlefoil',
			weapon_type: 'Steel',
			athlete_name: 'Shohei Ohtani',
			card_number: null
		});
		expect(q).toBe(`(Showtime, "Shohei Ohtani") "Bo Jackson Battle Arena" Headlines`);
	});

	it('builds a minimal query for paper cards with no athlete or weapon', () => {
		const q = buildEbayQuery({
			hero_name: 'Pulling the Plug',
			name: 'Pulling the Plug',
			parallel: 'Paper',
			weapon_type: null,
			athlete_name: null,
			card_number: 'PL-70'
		});
		expect(q).toBe(`"Pulling the Plug" "Bo Jackson Battle Arena" PL-70`);
	});

	it('drops the discriminator entirely when card_number and parallel are both absent', () => {
		const q = buildEbayQuery({
			hero_name: 'Tester',
			name: 'Tester',
			parallel: null,
			weapon_type: 'Fire',
			athlete_name: null,
			card_number: null
		});
		expect(q).toBe(`Tester "Bo Jackson Battle Arena"`);
	});

	it('case-insensitive paper detection', () => {
		const q = buildEbayQuery({
			hero_name: 'Test',
			name: 'Test',
			parallel: 'paper',
			weapon_type: 'Steel',
			athlete_name: null,
			card_number: 'P-1'
		});
		expect(q).toBe(`Test "Bo Jackson Battle Arena" P-1`);
	});

	it('falls back to stripping " Battlefoil" suffix for unmapped parallels', () => {
		const q = buildEbayQuery({
			hero_name: 'X',
			name: 'X',
			parallel: 'Some New Battlefoil',
			weapon_type: 'Fire',
			athlete_name: null,
			card_number: 'SN-1'
		});
		expect(q).toBe(`X "Bo Jackson Battle Arena" (SN-1, "Some New")`);
	});
});

describe('filterRelevantListings — hardened pipeline', () => {
	const card: EbayQueryCard = {
		hero_name: 'Bojax',
		name: 'Bojax',
		athlete_name: null,
		parallel: 'Blue Battlefoil',
		weapon_type: 'Ice',
		card_number: 'BBF-1'
	};

	it('rejects graded slab listings (PSA / BGS / SGC / CGC / TAG)', () => {
		const items = [
			{ title: 'Bojax Bo Jackson Battle Arena BBF-1 Blue Ice PSA 10' },
			{ title: 'Bojax Battle Arena BBF-1 BGS 9.5' },
			{ title: 'Bojax Battle Arena BBF-1 graded gem mint' },
			{ title: 'Bojax Battle Arena BBF-1 slab' }
		];
		expect(filterRelevantListings(items, card)).toHaveLength(0);
	});

	it('rejects sealed / box / pack listings', () => {
		const items = [
			{ title: 'Bo Jackson Battle Arena hobby box sealed' },
			{ title: 'Bo Jackson Battle Arena blaster box' },
			{ title: 'Bo Jackson Battle Arena jumbo pack factory sealed' }
		];
		expect(filterRelevantListings(items, card)).toHaveLength(0);
	});

	it('rejects lots / multi-card / complete-set listings', () => {
		const items = [
			{ title: 'Lot of 50 Bo Jackson Battle Arena BBF-1 Blue cards' },
			{ title: 'Bo Jackson Battle Arena complete set Bojax' },
			{ title: 'Bo Jackson Battle Arena Bojax bundle' }
		];
		expect(filterRelevantListings(items, card)).toHaveLength(0);
	});

	it('rejects vintage Bo Jackson memorabilia (Topps / Royals / starting lineup)', () => {
		const items = [
			{ title: '1991 Topps Bo Jackson Royals card' },
			{ title: 'Bo Jackson starting lineup figure 1990' },
			{ title: 'Bo Jackson Auburn jersey vintage' }
		];
		expect(filterRelevantListings(items, card)).toHaveLength(0);
	});

	it('rejects listings that lack the "Battle Arena" anchor', () => {
		const items = [{ title: 'Bojax BBF-1 Blue Ice random card' }];
		expect(filterRelevantListings(items, card)).toHaveLength(0);
	});

	it('rejects when no hero / athlete / card_number appears in title', () => {
		const items = [{ title: 'Bo Jackson Battle Arena random other card' }];
		expect(filterRelevantListings(items, card)).toHaveLength(0);
	});

	it('drops listings whose title mentions a different weapon (Ice card vs Fire title)', () => {
		const items = [
			{ title: 'Bojax Bo Jackson Battle Arena BBF-1 Blue Fire' } // wrong weapon
		];
		expect(filterRelevantListings(items, card)).toHaveLength(0);
	});

	it('keeps a clean Blue Ice Bojax listing', () => {
		const items = [
			{ title: 'Bojax Bo Jackson Battle Arena BBF-1 Blue Ice rookie' }
		];
		expect(filterRelevantListings(items, card)).toHaveLength(1);
	});

	it('rejects when card has Blue parallel but title shows different parallel only', () => {
		const items = [
			{ title: 'Bojax Bo Jackson Battle Arena BBF-1 Headlines Ice' } // wrong parallel, no Blue/BBF reference
		];
		// "BBF-1" is in the title — identity passes via card_number; but parallel
		// gate requires "Blue" or "Blue Battlefoil" in the title. "BBF-1" alone
		// isn't enough for parallel matching.
		// Title contains "BBF-1" so it's normalized as cardnum match, but
		// matchesParallel checks for "BLUE" or short prefix in title.
		expect(filterRelevantListings(items, card)).toHaveLength(0);
	});

	it('accepts paper card listings without a parallel gate', () => {
		const paperCard: EbayQueryCard = {
			hero_name: 'Time',
			name: 'Time',
			athlete_name: 'Damian Lillard',
			parallel: 'Paper',
			weapon_type: 'Fire',
			card_number: '94'
		};
		const items = [{ title: 'Damian Lillard Time Bo Jackson Battle Arena 94 Fire' }];
		expect(filterRelevantListings(items, paperCard)).toHaveLength(1);
	});

	it('accepts a Headlines Battlefoil listing matched via the "Headlines" prefix', () => {
		const headlinesCard: EbayQueryCard = {
			hero_name: 'Showtime',
			name: 'Showtime',
			athlete_name: 'Shohei Ohtani',
			parallel: 'Headlines Battlefoil',
			weapon_type: 'Steel',
			card_number: 'HBF-12'
		};
		const items = [
			{ title: 'Shohei Ohtani Showtime Bo Jackson Battle Arena HBF-12 Headlines Steel' }
		];
		expect(filterRelevantListings(items, headlinesCard)).toHaveLength(1);
	});
});
