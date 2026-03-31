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

	if (!VALID_SORTS.has(sort) && sort !== 'price_asc') {
		throw error(400, 'Invalid sort parameter');
	}

	if (cardType === 'play') {
		return handlePlayCards(admin, { priceMin, priceMax, sort, limit, offset });
	}

	// ── Build hero card query ────────────────────────
	let query = admin
		.from('cards')
		.select(`
			id, hero_name, name, card_number, set_code, power, rarity,
			weapon_type, parallel, athlete_name,
			price_cache!inner (
				price_low, price_mid, price_high,
				buy_now_low, buy_now_mid, buy_now_count,
				listings_count, filtered_count, confidence_score,
				fetched_at
			)
		`)
		.eq('price_cache.source', 'ebay')
		.not('price_cache.price_mid', 'is', null);

	// Apply filters
	if (parallel) query = query.eq('parallel', parallel);
	if (weapon) query = query.eq('weapon_type', weapon);
	if (set) query = query.eq('set_code', set);
	if (hero) query = query.eq('hero_name', hero);
	if (rarity) query = query.eq('rarity', rarity);
	if (powerMin > 0) query = query.gte('power', powerMin);
	if (powerMax > 0) query = query.lte('power', powerMax);

	// Price filters on joined table
	if (priceMin > 0) query = query.gte('price_cache.price_mid', priceMin);
	if (priceMax > 0) query = query.lte('price_cache.price_mid', priceMax);

	// Sorting (power_per_dollar sorted client-side after fetch)
	switch (sort) {
		case 'price_desc':
			query = query.order('price_mid', { referencedTable: 'price_cache', ascending: false });
			break;
		case 'power_desc':
			query = query.order('power', { ascending: false });
			break;
		case 'listings':
			query = query.order('listings_count', { referencedTable: 'price_cache', ascending: false });
			break;
		case 'confidence':
			query = query.order('confidence_score', { referencedTable: 'price_cache', ascending: false });
			break;
		default:
			query = query.order('price_mid', { referencedTable: 'price_cache', ascending: true });
	}

	query = query.range(offset, offset + limit - 1);

	const { data: rows, error: queryErr } = await query;

	if (queryErr) {
		console.error('[market/explore] Query failed:', queryErr);
		throw error(500, 'Failed to query market data');
	}

	// ── Transform results ────────────────────────────
	const cards = (rows || []).map((row: Record<string, unknown>) => {
		const priceRaw = row.price_cache;
		const price = (Array.isArray(priceRaw) ? priceRaw[0] : priceRaw) as Record<string, unknown> | undefined;
		const mid = Number(price?.price_mid ?? 0);
		const power = (row.power as number) ?? 0;
		const bnMid = price?.buy_now_mid != null ? Number(price.buy_now_mid) : null;
		const bnCount = (price?.buy_now_count as number) ?? 0;
		const listings = (price?.listings_count as number) ?? 0;

		return {
			id: row.id,
			hero: row.hero_name || row.name || 'Unknown',
			num: row.card_number || '',
			set: row.set_code || '',
			power,
			rarity: row.rarity || '',
			weapon: row.weapon_type || '',
			parallel: row.parallel || '',
			athlete: row.athlete_name || '',
			priceMid: mid,
			priceLow: Number(price?.price_low ?? 0),
			priceHigh: Number(price?.price_high ?? 0),
			bnMid,
			bnLow: price?.buy_now_low != null ? Number(price.buy_now_low) : null,
			bnCount,
			listings,
			filtered: (price?.filtered_count as number) ?? 0,
			confidence: Number(price?.confidence_score ?? 0),
			fetchedAt: price?.fetched_at || null,
			// Computed metrics
			pricePerPower: power > 0 ? Math.round((mid / power) * 100) / 100 : null,
			bnPremium: bnMid && mid > 0 ? Math.round(((bnMid - mid) / mid) * 10000) / 100 : null,
			liquidity: listings >= 10 ? 'available' : listings >= 3 ? 'limited' : listings >= 1 ? 'scarce' : 'none',
		};
	});

	// Client-side sort for computed metrics
	if (sort === 'power_per_dollar') {
		cards.sort((a, b) => (a.pricePerPower ?? 999) - (b.pricePerPower ?? 999));
	}

	// ── Aggregates ───────────────────────────────────
	const aggregates = buildAggregates(cards);

	return json({
		cards,
		aggregates,
		pagination: { offset, limit, hasMore: cards.length === limit },
	}, {
		headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' }
	});
};

/** Handle play card queries (separate table) */
async function handlePlayCards(
	admin: ReturnType<typeof getAdminClient> & object,
	opts: { priceMin: number; priceMax: number; sort: string; limit: number; offset: number }
) {
	let query = admin
		.from('play_cards')
		.select(`
			id, name, card_number, release, dbs, hot_dog_cost, ability_text,
			price_cache!inner (
				price_low, price_mid, price_high,
				buy_now_low, buy_now_mid, buy_now_count,
				listings_count, filtered_count, confidence_score,
				fetched_at
			)
		`)
		.eq('price_cache.source', 'ebay')
		.not('price_cache.price_mid', 'is', null);

	if (opts.priceMin > 0) query = query.gte('price_cache.price_mid', opts.priceMin);
	if (opts.priceMax > 0) query = query.lte('price_cache.price_mid', opts.priceMax);

	switch (opts.sort) {
		case 'price_desc':
			query = query.order('price_mid', { referencedTable: 'price_cache', ascending: false });
			break;
		case 'listings':
			query = query.order('listings_count', { referencedTable: 'price_cache', ascending: false });
			break;
		default:
			query = query.order('price_mid', { referencedTable: 'price_cache', ascending: true });
	}

	query = query.range(opts.offset, opts.offset + opts.limit - 1);

	const { data: rows, error: queryErr } = await query;

	if (queryErr) {
		console.error('[market/explore] Play query failed:', queryErr);
		throw error(500, 'Failed to query play card data');
	}

	const cards = (rows || []).map((row: Record<string, unknown>) => {
		const priceRaw = row.price_cache;
		const price = (Array.isArray(priceRaw) ? priceRaw[0] : priceRaw) as Record<string, unknown> | undefined;
		const mid = Number(price?.price_mid ?? 0);
		const dbs = (row.dbs as number) ?? 0;
		const listings = (price?.listings_count as number) ?? 0;

		return {
			id: row.id,
			name: row.name || 'Unknown',
			num: row.card_number || '',
			release: row.release || '',
			dbs,
			hotDogCost: (row.hot_dog_cost as number) ?? 0,
			ability: row.ability_text || '',
			priceMid: mid,
			priceLow: Number(price?.price_low ?? 0),
			priceHigh: Number(price?.price_high ?? 0),
			bnMid: price?.buy_now_mid != null ? Number(price.buy_now_mid) : null,
			bnLow: price?.buy_now_low != null ? Number(price.buy_now_low) : null,
			bnCount: (price?.buy_now_count as number) ?? 0,
			listings,
			filtered: (price?.filtered_count as number) ?? 0,
			confidence: Number(price?.confidence_score ?? 0),
			fetchedAt: price?.fetched_at || null,
			// Play-specific computed metrics
			pricePerDbs: dbs > 0 ? Math.round((mid / dbs) * 100) / 100 : null,
			liquidity: listings >= 10 ? 'available' : listings >= 3 ? 'limited' : listings >= 1 ? 'scarce' : 'none',
		};
	});

	return json({
		cards,
		aggregates: buildAggregates(cards),
		pagination: { offset: opts.offset, limit: opts.limit, hasMore: cards.length === opts.limit },
	}, {
		headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' }
	});
}

function buildAggregates(cards: { priceMid: number; listings: number; bnCount: number; confidence: number }[]) {
	if (cards.length === 0) {
		return { totalResults: 0, avgPrice: 0, totalListings: 0, totalBnAvailable: 0, avgConfidence: 0, priceRange: null };
	}
	const prices = cards.map(c => c.priceMid);
	return {
		totalResults: cards.length,
		avgPrice: Math.round(prices.reduce((s, p) => s + p, 0) / cards.length * 100) / 100,
		totalListings: cards.reduce((s, c) => s + c.listings, 0),
		totalBnAvailable: cards.reduce((s, c) => s + c.bnCount, 0),
		avgConfidence: Math.round(cards.reduce((s, c) => s + c.confidence, 0) / cards.length * 100),
		priceRange: { min: Math.min(...prices), max: Math.max(...prices) },
	};
}
