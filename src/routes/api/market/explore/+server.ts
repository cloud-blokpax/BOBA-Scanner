/**
 * GET /api/market/explore — Filterable market explorer
 *
 * Query params (all optional, combine freely):
 *   parallel    - Filter by parallel type (e.g., "80's Rad Battlefoil")
 *   weapon      - Filter by weapon type (e.g., "Fire")
 *   set         - Filter by set_code (e.g., "AE")
 *   hero        - Filter by hero_name (e.g., "Tattoo")
 *   power_min   - Minimum power (e.g., 135)
 *   power_max   - Maximum power
 *   price_min   - Minimum price_mid
 *   price_max   - Maximum price_mid
 *   rarity      - Filter by rarity
 *   card_type   - "hero" (default) or "play"
 *   sort        - "price_asc" | "price_desc" | "power_desc" | "power_per_dollar" | "listings" | "confidence"
 *   limit       - Max results (default 50, max 200)
 *   offset      - Pagination offset
 *
 * Returns:
 *   cards: matching cards with pricing
 *   aggregates: stats for current filter
 *   pagination: offset, limit, hasMore
 */

import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

const VALID_SORTS = new Set([
	'price_asc', 'price_desc', 'power_desc', 'power_per_dollar', 'listings', 'confidence'
]);

export const GET: RequestHandler = async ({ url, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Sign in to explore market data');

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database unavailable');

	// ── Parse filters ────────────────────────────────
	const parallel = url.searchParams.get('parallel');
	const weapon = url.searchParams.get('weapon');
	const set = url.searchParams.get('set');
	const hero = url.searchParams.get('hero');
	const rarity = url.searchParams.get('rarity');
	const powerMin = parseInt(url.searchParams.get('power_min') || '') || 0;
	const powerMax = parseInt(url.searchParams.get('power_max') || '') || 0;
	const priceMin = parseFloat(url.searchParams.get('price_min') || '') || 0;
	const priceMax = parseFloat(url.searchParams.get('price_max') || '') || 0;
	const cardType = url.searchParams.get('card_type') || 'hero';
	const sort = url.searchParams.get('sort') || 'price_asc';
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '') || 50, 1), 200);
	const offset = Math.max(parseInt(url.searchParams.get('offset') || '') || 0, 0);

	const gameId = url.searchParams.get('game_id') || 'boba';
	if (!['boba', 'wonders'].includes(gameId)) {
		throw error(400, 'Invalid game_id');
	}

	if (!VALID_SORTS.has(sort) && sort !== 'price_asc') {
		throw error(400, 'Invalid sort parameter');
	}

	// Default priced_only to true — most users want priced cards, and it avoids
	// the problematic LEFT JOIN + sort on 17K+ rows that can return 0 results.
	const pricedOnly = url.searchParams.get('priced_only') !== 'false';

	if (cardType === 'play') {
		return handlePlayCards(admin, { priceMin, priceMax, sort, limit, offset, pricedOnly: pricedOnly || priceMin > 0 || priceMax > 0 });
	}

	// ── Two-query approach for hero cards ────────────
	// Avoids PostgREST LEFT JOIN quirks that cause 0 results when sorting
	// on a referenced table column across 17K+ rows.

	// Step 1: Get card metadata, applying card-level filters
	let cardQuery = admin
		.from('cards')
		.select('id, hero_name, name, card_number, set_code, power, rarity, weapon_type, parallel, athlete_name')
		.eq('game_id', gameId);

	if (parallel) cardQuery = cardQuery.eq('parallel', parallel);
	if (weapon) cardQuery = cardQuery.eq('weapon_type', weapon);
	if (set) cardQuery = cardQuery.eq('set_code', set);
	if (hero) cardQuery = cardQuery.eq('hero_name', hero);
	if (rarity) cardQuery = cardQuery.eq('rarity', rarity);
	if (powerMin > 0) cardQuery = cardQuery.gte('power', powerMin);
	if (powerMax > 0) cardQuery = cardQuery.lte('power', powerMax);

	// Paginate in 1k chunks to avoid Supabase's 1,000-row default limit
	const CHUNK = 1000;
	const cardRows: Array<Record<string, unknown>> = [];
	{
		let offset = 0;
		let done = false;
		while (!done) {
			const { data, error: cardErr } = await cardQuery.range(offset, offset + CHUNK - 1);
			if (cardErr) {
				console.error('[market/explore] Card query failed:', cardErr);
				throw error(500, 'Failed to query card data');
			}
			if (!data || data.length === 0) { done = true; }
			else {
				cardRows.push(...data);
				offset += CHUNK;
				if (data.length < CHUNK) done = true;
			}
		}
	}
	if (cardRows.length === 0) {
		return json({
			cards: [],
			aggregates: buildAggregates([]),
			pagination: { offset, limit, hasMore: false },
		}, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } });
	}

	// Step 2: Get pricing data for all matching cards (batched to avoid URL length limits)
	const cardIds = cardRows.map(c => String(c.id));
	const BATCH_SIZE = 200;
	const priceRows: Array<Record<string, unknown>> = [];

	for (let i = 0; i < cardIds.length; i += BATCH_SIZE) {
		const batch = cardIds.slice(i, i + BATCH_SIZE);
		let priceQuery = admin
			.from('price_cache')
			.select('card_id, price_low, price_mid, price_high, buy_now_low, buy_now_mid, buy_now_count, listings_count, filtered_count, confidence_score, fetched_at')
			.eq('source', 'ebay')
			.in('card_id', batch);

		if (priceMin > 0) priceQuery = priceQuery.gte('price_mid', priceMin);
		if (priceMax > 0) priceQuery = priceQuery.lte('price_mid', priceMax);

		const { data, error: priceErr } = await priceQuery;
		if (priceErr) {
			console.error('[market/explore] Price batch query failed:', priceErr);
			continue;
		}
		if (data) priceRows.push(...data);
	}

	// Step 3: Merge cards with pricing data
	const priceMap = new Map((priceRows || []).map(p => [String(p.card_id), p]));

	type MergedCard = {
		id: unknown; hero: unknown; num: unknown; set: unknown; power: number;
		rarity: unknown; weapon: unknown; parallel: unknown; athlete: unknown;
		priceMid: number; priceLow: number; priceHigh: number;
		bnMid: number | null; bnLow: number | null; bnCount: number;
		listings: number; filtered: number; confidence: number;
		fetchedAt: unknown; hasPriceData: boolean;
		pricePerPower: number | null; bnPremium: number | null; liquidity: string;
	};

	const allCards: MergedCard[] = cardRows.map(card => {
		const c = card as Record<string, unknown>;
		const pr = priceMap.get(String(c.id));
		const hasPriceData = pr != null && pr.price_mid != null;
		const mid = hasPriceData ? Number(pr.price_mid) : 0;
		const power = (c.power as number) ?? 0;
		const bnMid = pr?.buy_now_mid != null ? Number(pr.buy_now_mid) : null;
		const bnCount = (pr?.buy_now_count as number) ?? 0;
		const listings = (pr?.listings_count as number) ?? 0;

		return {
			id: c.id,
			hero: c.hero_name || c.name || 'Unknown',
			num: c.card_number || '',
			set: c.set_code || '',
			power,
			rarity: c.rarity || '',
			weapon: c.weapon_type || '',
			parallel: c.parallel || '',
			athlete: c.athlete_name || '',
			priceMid: mid,
			priceLow: hasPriceData ? Number(pr.price_low ?? 0) : 0,
			priceHigh: hasPriceData ? Number(pr.price_high ?? 0) : 0,
			bnMid,
			bnLow: pr?.buy_now_low != null ? Number(pr.buy_now_low) : null,
			bnCount,
			listings,
			filtered: (pr?.filtered_count as number) ?? 0,
			confidence: hasPriceData ? Number(pr.confidence_score ?? 0) : 0,
			fetchedAt: pr?.fetched_at || null,
			hasPriceData,
			pricePerPower: hasPriceData && power > 0 ? Math.round((mid / power) * 100) / 100 : null,
			bnPremium: bnMid && mid > 0 ? Math.round(((bnMid - mid) / mid) * 10000) / 100 : null,
			liquidity: !hasPriceData ? 'unknown' : listings >= 10 ? 'available' : listings >= 3 ? 'limited' : listings >= 1 ? 'scarce' : 'none',
		};
	});

	// Filter to priced-only if requested (or if price range filters are active)
	const effectivePricedOnly = pricedOnly || priceMin > 0 || priceMax > 0;
	const filteredCards = effectivePricedOnly ? allCards.filter(c => c.hasPriceData) : allCards;

	// Sort
	switch (sort) {
		case 'price_desc':
			filteredCards.sort((a, b) => b.priceMid - a.priceMid);
			break;
		case 'power_per_dollar':
			filteredCards.sort((a, b) => (a.pricePerPower ?? 999) - (b.pricePerPower ?? 999));
			break;
		case 'power_desc':
			filteredCards.sort((a, b) => b.power - a.power);
			break;
		case 'listings':
			filteredCards.sort((a, b) => b.listings - a.listings);
			break;
		case 'confidence':
			filteredCards.sort((a, b) => b.confidence - a.confidence);
			break;
		default: // price_asc
			filteredCards.sort((a, b) => {
				// Unpriced cards go to end when sorting by price
				if (!a.hasPriceData && !b.hasPriceData) return 0;
				if (!a.hasPriceData) return 1;
				if (!b.hasPriceData) return -1;
				return a.priceMid - b.priceMid;
			});
	}

	// Step 4: Paginate
	const cards = filteredCards.slice(offset, offset + limit);

	// ── Aggregates (from ALL matching cards, not just current page) ──
	const aggregates = buildAggregates(filteredCards);

	return json({
		cards,
		aggregates: { ...aggregates, totalResults: filteredCards.length },
		pagination: { offset, limit, hasMore: offset + limit < filteredCards.length },
	}, {
		headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' }
	});
};

/** Handle play card queries (separate table, two-query approach) */
async function handlePlayCards(
	admin: ReturnType<typeof getAdminClient> & object,
	opts: { priceMin: number; priceMax: number; sort: string; limit: number; offset: number; pricedOnly: boolean }
) {
	// Play card prices live in play_price_cache (TEXT card_id), not price_cache (UUID).
	// Two-query approach: fetch prices from play_price_cache, fetch card details, merge.

	// Step 1: Get all play card prices from play_price_cache
	let priceQuery = admin
		.from('play_price_cache')
		.select('card_id, price_low, price_mid, price_high, buy_now_low, buy_now_mid, buy_now_count, listings_count, filtered_count, confidence_score, fetched_at')
		.eq('source', 'ebay')
		.not('price_mid', 'is', null);

	if (opts.priceMin > 0) priceQuery = priceQuery.gte('price_mid', opts.priceMin);
	if (opts.priceMax > 0) priceQuery = priceQuery.lte('price_mid', opts.priceMax);

	switch (opts.sort) {
		case 'price_desc':
			priceQuery = priceQuery.order('price_mid', { ascending: false });
			break;
		case 'listings':
			priceQuery = priceQuery.order('listings_count', { ascending: false });
			break;
		case 'confidence':
			priceQuery = priceQuery.order('confidence_score', { ascending: false });
			break;
		default:
			priceQuery = priceQuery.order('price_mid', { ascending: true });
	}

	// Paginate in 1k chunks to avoid Supabase's 1,000-row limit
	const priceRows: Array<Record<string, unknown>> = [];
	{
		let offset = 0;
		let done = false;
		while (!done) {
			const { data, error: priceErr } = await priceQuery.range(offset, offset + 1000 - 1);
			if (priceErr) {
				console.error('[market/explore] Play card price query failed:', priceErr);
				throw error(500, 'Failed to query play card prices');
			}
			if (!data || data.length === 0) { done = true; }
			else {
				priceRows.push(...data);
				offset += 1000;
				if (data.length < 1000) done = true;
			}
		}
	}
	if (priceRows.length === 0) {
		return json({
			cards: [],
			aggregates: buildAggregates([]),
			pagination: { offset: opts.offset, limit: opts.limit, hasMore: false }
		}, { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } });
	}

	// Step 2: Get play card details — filter to only the IDs that have prices
	const pricedIds = priceRows.map(r => String(r.card_id));
	const { data: playCards, error: playErr } = await admin
		.from('play_cards')
		.select('id, name, card_number, release, dbs, hot_dog_cost, ability_text')
		.in('id', pricedIds);

	if (playErr) {
		console.error('[market/explore] Play card details query failed:', playErr);
		throw error(500, 'Failed to query play card details');
	}

	// Step 3: Merge prices with play card details
	const playMap = new Map((playCards || []).map(p => [String(p.id), p]));

	const merged = priceRows
		.filter(pr => playMap.has(String(pr.card_id)))
		.map(pr => {
			const play = playMap.get(String(pr.card_id))!;
			const mid = Number(pr.price_mid ?? 0);
			const listings = (pr.listings_count as number) ?? 0;
			const dbs = ((play as Record<string, unknown>).dbs as number) ?? 0;
			return {
				id: play.id,
				name: (play as Record<string, unknown>).name || 'Unknown',
				num: (play as Record<string, unknown>).card_number || '',
				release: (play as Record<string, unknown>).release || '',
				dbs,
				hotDogCost: ((play as Record<string, unknown>).hot_dog_cost as number) ?? 0,
				ability: (play as Record<string, unknown>).ability_text || '',
				priceMid: mid,
				priceLow: Number(pr.price_low ?? 0),
				priceHigh: Number(pr.price_high ?? 0),
				bnMid: pr.buy_now_mid != null ? Number(pr.buy_now_mid) : null,
				bnLow: pr.buy_now_low != null ? Number(pr.buy_now_low) : null,
				bnCount: (pr.buy_now_count as number) ?? 0,
				listings,
				filtered: (pr.filtered_count as number) ?? 0,
				confidence: Number(pr.confidence_score ?? 0),
				fetchedAt: pr.fetched_at || null,
				pricePerDbs: dbs > 0 ? Math.round((mid / dbs) * 100) / 100 : null,
				liquidity: listings >= 10 ? 'available' : listings >= 3 ? 'limited' : listings >= 1 ? 'scarce' : 'none',
			};
		});

	// Step 4: Paginate the merged results
	const paginated = merged.slice(opts.offset, opts.offset + opts.limit);

	return json({
		cards: paginated,
		aggregates: buildAggregates(merged.map(c => ({ priceMid: c.priceMid, listings: c.listings, bnCount: c.bnCount, confidence: c.confidence }))),
		pagination: { offset: opts.offset, limit: opts.limit, hasMore: opts.offset + opts.limit < merged.length }
	}, {
		headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' }
	});
}

function buildAggregates(cards: { priceMid: number | null; listings: number; bnCount: number; confidence: number; hasPriceData?: boolean }[]) {
	if (cards.length === 0) {
		return { totalResults: 0, pricedCount: 0, avgPrice: 0, totalListings: 0, totalBnAvailable: 0, avgConfidence: 0, priceRange: null };
	}
	const pricedCards = cards.filter(c => c.priceMid != null);
	const prices = pricedCards.map(c => c.priceMid as number);
	return {
		totalResults: cards.length,
		pricedCount: pricedCards.length,
		avgPrice: prices.length > 0 ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length * 100) / 100 : 0,
		totalListings: cards.reduce((s, c) => s + c.listings, 0),
		totalBnAvailable: cards.reduce((s, c) => s + c.bnCount, 0),
		avgConfidence: pricedCards.length > 0 ? Math.round(pricedCards.reduce((s, c) => s + c.confidence, 0) / pricedCards.length * 100) : 0,
		priceRange: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
	};
}
