/**
 * GET /api/price/[cardId] — eBay price lookup with caching
 *
 * Checks Supabase price_cache first (1-hour TTL).
 * If stale: calls eBay Browse API → updates cache → returns.
 *
 * Cache headers enable Vercel edge caching (s-maxage).
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

let _ebayToken: string | null = null;
let _ebayTokenExp = 0;

async function getEbayToken(): Promise<string> {
	if (_ebayToken && Date.now() < _ebayTokenExp) return _ebayToken;

	const clientId = env.EBAY_CLIENT_ID;
	const clientSecret = env.EBAY_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('eBay credentials not configured');
	}

	const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
	const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${creds}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
	});

	if (!response.ok) throw new Error(`eBay auth failed: ${response.status}`);
	const data = await response.json();
	_ebayToken = data.access_token;
	_ebayTokenExp = Date.now() + (data.expires_in - 60) * 1000;
	return _ebayToken!;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const { cardId } = params;

	// Check auth (optional — prices can be public)
	const { user } = await locals.safeGetSession();

	// Check price cache (1-hour freshness)
	const { data: cachedRaw } = await locals.supabase
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
		.select('name, card_number, set_code')
		.eq('id', cardId)
		.single();

	if (!card) {
		throw error(404, 'Card not found');
	}

	// Build eBay search query
	const query = `BOBA ${card.name} ${card.card_number || ''} ${card.set_code || ''}`.trim();

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

		// Update cache
		await locals.supabase.from('price_cache').upsert(priceData, {
			onConflict: 'card_id,source'
		});

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
