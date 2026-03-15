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
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

// Helper: get a service-role client for cache writes (bypasses RLS)
function getServiceClient() {
	const url = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
	if (!url || !serviceKey) return null;
	return createClient(url, serviceKey);
}

export const GET: RequestHandler = async ({ params, locals }) => {
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

	if (!locals.supabase) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	// Check price cache (1-hour freshness) — use service role to bypass RLS
	const cacheClient = getServiceClient() || locals.supabase;
	const { data: cachedRaw } = await cacheClient
		.from('price_cache')
		.select('*')
		.eq('card_id', cardId)
		.eq('source', 'ebay')
		.single();

	const cached = cachedRaw as { card_id: string; source: string; price_low: number | null; price_mid: number | null; price_high: number | null; listings_count: number | null; fetched_at: string } | null;

	if (cached) {
		const age = Date.now() - new Date(cached.fetched_at).getTime();
		if (age < 3600_000) {
			return json(cached, {
				headers: {
					'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200'
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

		// Calculate price statistics
		const prices = items
			.map((item: { price?: { value?: string } }) => parseFloat(item.price?.value || '0'))
			.filter((p: number) => p > 0)
			.sort((a: number, b: number) => a - b);

		const priceData = {
			card_id: cardId,
			source: 'ebay',
			price_low: prices.length > 0 ? prices[0] : null,
			price_mid: prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null,
			price_high: prices.length > 0 ? prices[prices.length - 1] : null,
			listings_count: prices.length,
			fetched_at: new Date().toISOString()
		};

		// Update cache — use service role to bypass RLS (price_cache is server-managed)
		try {
			const adminClient = getServiceClient();
			const writeCacheClient = adminClient || locals.supabase;
			await writeCacheClient.from('price_cache').upsert(priceData, {
				onConflict: 'card_id,source'
			});
		} catch {
			console.warn('[api/price] Cache write failed (possible RLS issue)');
		}

		return json(priceData, {
			headers: {
				'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200'
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
