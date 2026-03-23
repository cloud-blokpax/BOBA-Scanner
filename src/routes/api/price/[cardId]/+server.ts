/**
 * GET /api/price/[cardId] — eBay price lookup with caching
 *
 * Checks Supabase price_cache first (1-hour TTL).
 * If stale: calls eBay Browse API → updates cache → returns.
 *
 * Cache headers enable Vercel edge caching (s-maxage).
 */

import { json, error } from '@sveltejs/kit';
import { getEbayToken, isEbayConfigured } from '$lib/server/ebay-auth';
import { checkEbayDailyLimit } from '$lib/server/redis';
import { checkAnonScanRateLimit } from '$lib/server/rate-limit';
import { getAdminClient } from '$lib/server/supabase-admin';
import { calculatePriceStats } from '$lib/utils/pricing';
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
		const rateLimit = await checkAnonScanRateLimit(getClientAddress());
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
		.select('name, hero_name, card_number, set_code')
		.eq('id', cardId)
		.single();

	if (!card) {
		throw error(404, 'Card not found');
	}

	// Build eBay search query — "bo jackson battle arena" is the key phrase sellers use
	const heroOrName = card.hero_name || card.name || '';
	const cardNum = card.card_number || '';
	const query = `bo jackson battle arena ${heroOrName} ${cardNum}`.trim();

	// Check eBay daily API call limit (4,500/day with 500 headroom)
	const withinLimit = await checkEbayDailyLimit();
	if (!withinLimit) {
		if (cached) return json(cached, { headers: { 'Cache-Control': 's-maxage=60' } });
		return json({ error: 'Price lookups temporarily limited' }, { status: 503 });
	}

	try {
		const token = await getEbayToken();
		const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
		searchUrl.searchParams.set('q', query);
		searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
		searchUrl.searchParams.set('limit', '50');

		const browseRes = await fetch(searchUrl.toString(), {
			headers: {
				Authorization: `Bearer ${token}`,
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
			}
		});

		if (!browseRes.ok) {
			throw error(502, 'eBay API error');
		}

		const data = await browseRes.json();
		const items = data.itemSummaries || [];

		// Calculate price statistics with IQR outlier filtering
		const rawPrices = items
			.map((item: { price?: { value?: string } }) => parseFloat(item.price?.value || '0'))
			.filter((p: number) => p > 0);

		const stats = calculatePriceStats(rawPrices);

		const priceData = {
			card_id: cardId,
			source: 'ebay',
			price_low: stats?.low ?? null,
			price_mid: stats?.median ?? null,
			price_high: stats?.high ?? null,
			listings_count: rawPrices.length,
			filtered_count: stats?.filteredCount ?? rawPrices.length,
			confidence_score: stats?.confidenceScore ?? 0,
			fetched_at: new Date().toISOString()
		};

		// Update cache — use service role to bypass RLS (price_cache is server-managed)
		try {
			const adminClient = getAdminClient();
			const writeCacheClient = adminClient || locals.supabase;
			await writeCacheClient.from('price_cache').upsert(priceData, {
				onConflict: 'card_id,source'
			});
		} catch (err) {
			console.debug('[api/price] Cache write failed:', err);
			console.warn('[api/price] Cache write failed (possible RLS issue)');
		}

		// Log price data point to history — only when price actually changed
		try {
			const historyClient = getAdminClient() || locals.supabase;
			const { data: lastEntry } = await historyClient
				.from('price_history')
				.select('price_mid')
				.eq('card_id', cardId)
				.order('recorded_at', { ascending: false })
				.limit(1)
				.maybeSingle();

			const priceChanged = !lastEntry || lastEntry.price_mid !== priceData.price_mid;
			if (priceChanged) {
				await historyClient.from('price_history').insert({
					card_id: cardId,
					source: 'ebay',
					price_low: priceData.price_low,
					price_mid: priceData.price_mid,
					price_high: priceData.price_high,
					listings_count: priceData.listings_count,
					recorded_at: new Date().toISOString()
				});
			}
		} catch (err) {
			console.debug('[api/price] Price history write failed:', err);
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
