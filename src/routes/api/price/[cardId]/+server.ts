/**
 * GET /api/price/[cardId] — eBay price lookup with caching
 *
 * Checks Supabase price_cache first (1-hour TTL).
 * If stale: calls eBay Browse API → updates cache → returns.
 *
 * Cache headers enable Vercel edge caching (s-maxage).
 */

import { json, error } from '@sveltejs/kit';
import { isEbayConfigured, ebayFetch } from '$lib/server/ebay-auth';
import { checkEbayDailyLimit } from '$lib/server/redis';
import { checkAnonPriceRateLimit } from '$lib/server/rate-limit';
import { getAdminClient } from '$lib/server/supabase-admin';
import { calculatePriceStats } from '$lib/utils/pricing';

export const config = { maxDuration: 60 };
import { buildEbaySearchQuery, filterRelevantListings } from '$lib/server/ebay-query';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, getClientAddress }) => {
	const { cardId } = params;

	// Validate cardId format (UUID or alphanumeric identifier)
	if (!cardId || !/^[\w-]{1,64}$/.test(cardId)) {
		throw error(400, 'Invalid card ID');
	}

	if (!isEbayConfigured()) {
		return json({ error: 'eBay pricing not available' }, { status: 503 });
	}

	// Check auth (optional — prices can be public)
	const { user } = await locals.safeGetSession();

	// Rate limit anonymous price lookups to prevent eBay API abuse
	if (!user) {
		const rateLimit = await checkAnonPriceRateLimit(getClientAddress());
		if (!rateLimit.success) {
			return json(
				{ error: 'Rate limited. Please sign in for unlimited price lookups.' },
				{
					status: 429,
					headers: {
						'X-RateLimit-Limit': String(rateLimit.limit),
						'X-RateLimit-Remaining': String(rateLimit.remaining),
						'X-RateLimit-Reset': String(rateLimit.reset)
					}
				}
			);
		}
	}

	if (!locals.supabase) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	// Check price cache (4-hour freshness) — use service role to bypass RLS
	const cacheClient = getAdminClient() || locals.supabase;
	const { data: cachedRaw } = await cacheClient
		.from('price_cache')
		.select('*')
		.eq('card_id', cardId)
		.eq('source', 'ebay')
		.single();

	const cached = cachedRaw as { card_id: string; source: string; price_low: number | null; price_mid: number | null; price_high: number | null; listings_count: number | null; fetched_at: string } | null;

	if (cached) {
		const age = Date.now() - new Date(cached.fetched_at).getTime();
		if (age < 14400_000) { // 4-hour TTL — BoBA card prices don't move hourly
			return json(cached, {
				headers: {
					'Cache-Control': 's-maxage=14400, stale-while-revalidate=28800'
				}
			});
		}
	}

	// Get card details for search query
	const { data: card } = await locals.supabase
		.from('cards')
		.select('name, hero_name, athlete_name, card_number, set_code, parallel, weapon_type')
		.eq('id', cardId)
		.single();

	if (!card) {
		throw error(404, 'Card not found');
	}

	const query = buildEbaySearchQuery(card);

	// Check eBay daily API call limit (4,500/day with 500 headroom)
	const withinLimit = await checkEbayDailyLimit();
	if (!withinLimit) {
		if (cached) return json(cached, { headers: { 'Cache-Control': 's-maxage=60' } });
		return json({ error: 'Price lookups temporarily limited' }, { status: 503 });
	}

	try {
		const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
		searchUrl.searchParams.set('q', query);
		searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
		searchUrl.searchParams.set('limit', '50');

		// ebayFetch handles token acquisition and automatic retry on 401
		const browseRes = await ebayFetch(searchUrl.toString());

		if (!browseRes.ok) {
			throw error(502, 'eBay API error');
		}

		const data = await browseRes.json();
		const rawItems: Array<{ title?: string; price?: { value?: string }; buyingOptions?: string[] }> = data.itemSummaries || [];

		// Filter to listings that actually match this card using tiered priority
		const items = filterRelevantListings(rawItems, card);

		// Separate fixed price from auction
		const fixedPriceItems = items.filter((item: { buyingOptions?: string[] }) =>
			item.buyingOptions?.includes('FIXED_PRICE')
		);

		const allPrices = items
			.map((item: { price?: { value?: string } }) => parseFloat(item.price?.value || '0'))
			.filter((p: number) => p > 0);

		const fixedPrices = fixedPriceItems
			.map((item: { price?: { value?: string } }) => parseFloat(item.price?.value || '0'))
			.filter((p: number) => p > 0);

		const allStats = calculatePriceStats(allPrices);
		const fixedStats = calculatePriceStats(fixedPrices);

		const priceData = {
			card_id: cardId,
			source: 'ebay',
			price_low: allStats?.low ?? null,
			price_mid: allStats?.median ?? null,
			price_high: allStats?.high ?? null,
			listings_count: allPrices.length,
			buy_now_low: fixedStats?.low ?? null,
			buy_now_mid: fixedStats?.median ?? null,
			buy_now_count: fixedPrices.length,
			filtered_count: allStats?.filteredCount ?? allPrices.length,
			confidence_score: allStats?.confidenceScore ?? 0,
			fetched_at: new Date().toISOString()
		};

		// Update cache — use service role to bypass RLS (price_cache is server-managed)
		try {
			const adminClient = getAdminClient();
			if (!adminClient) throw new Error('Admin client unavailable for cache write');
			const { error: cacheError } = await adminClient.from('price_cache').upsert(priceData, {
				onConflict: 'card_id,source'
			});
			if (cacheError) {
				console.error('[api/price] price_cache upsert FAILED:', cacheError.message);
			}
		} catch (err) {
			console.error('[api/price] Cache write exception:', err);
		}

		// Log price data point to history — only when price actually changed
		try {
			const historyClient = getAdminClient();
			if (!historyClient) throw new Error('Admin client unavailable for history write');
			const { data: lastEntry } = await historyClient
				.from('price_history')
				.select('price_mid')
				.eq('card_id', cardId)
				.order('recorded_at', { ascending: false })
				.limit(1)
				.maybeSingle();

			const priceChanged = !lastEntry || lastEntry.price_mid !== priceData.price_mid;
			if (priceChanged) {
				const { error: historyError } = await historyClient.from('price_history').insert({
					card_id: cardId,
					source: 'ebay',
					price_low: priceData.price_low,
					price_mid: priceData.price_mid,
					price_high: priceData.price_high,
					listings_count: priceData.listings_count,
					recorded_at: new Date().toISOString()
				});
				if (historyError) {
					console.error('[api/price] price_history insert FAILED:', historyError.message);
				}
			}
		} catch (err) {
			console.error('[api/price] Price history exception:', err);
		}

		return json(priceData, {
			headers: {
				'Cache-Control': 's-maxage=14400, stale-while-revalidate=28800'
			}
		});
	} catch (err) {
		// Return stale cached data if available
		if (cached) {
			return json(cached, {
				headers: { 'Cache-Control': 's-maxage=60' }
			});
		}
		throw error(502, 'Price lookup failed');
	}
};
