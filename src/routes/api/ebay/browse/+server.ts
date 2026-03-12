/**
 * POST /api/ebay/browse — eBay Browse API proxy
 *
 * Two modes:
 *   1. Price lookup: { query, cardNumber?, hero? } → avg/min/max prices
 *   2. Seller monitor: { seller } → active listings for a seller
 *
 * Auth required. Uses Client Credentials OAuth for eBay API.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

let _ebayToken: string | null = null;
let _ebayTokenExp = 0;

async function getEbayToken(): Promise<string> {
	if (_ebayToken && Date.now() < _ebayTokenExp) return _ebayToken;

	const clientId = env.EBAY_CLIENT_ID ?? '';
	const clientSecret = env.EBAY_CLIENT_SECRET ?? '';
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

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		throw error(401, 'Authentication required');
	}

	const { seller, query, cardNumber, hero } = await request.json();

	// Mode 1: keyword price lookup
	if (query) {
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
				throw error(502, `eBay Browse API: ${browseRes.status}`);
			}

			const data = await browseRes.json();
			const all = data.itemSummaries || [];

			// Filter to exact matches
			const cardNum = (cardNumber || '').toUpperCase();
			const heroStr = (hero || '').toUpperCase();
			const exact = all.filter((item: { title: string }) => {
				const t = item.title.toUpperCase();
				if (cardNum && t.includes(cardNum)) return true;
				if (heroStr && heroStr.length > 2 && t.includes(heroStr)) return true;
				return false;
			});

			const prices = exact
				.map((item: { price?: { value?: string } }) => parseFloat(item.price?.value ?? ''))
				.filter((p: number) => !isNaN(p) && p > 0);

			const avg = prices.length ? prices.reduce((a: number, b: number) => a + b, 0) / prices.length : null;
			const low = prices.length ? Math.min(...prices) : null;
			const high = prices.length ? Math.max(...prices) : null;

			return json({
				avgPrice: avg !== null ? parseFloat(avg.toFixed(2)) : null,
				lowPrice: low !== null ? parseFloat(low.toFixed(2)) : null,
				highPrice: high !== null ? parseFloat(high.toFixed(2)) : null,
				count: prices.length,
				total: all.length
			});
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('eBay browse error:', err);
			throw error(500, 'eBay price lookup failed');
		}
	}

	// Mode 2: seller listing monitor
	if (!seller?.trim()) {
		throw error(400, 'Missing seller username or query');
	}

	try {
		const token = await getEbayToken();
		const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
		searchUrl.searchParams.set('q', 'bo jackson');
		searchUrl.searchParams.set('filter', `sellers:{${seller.trim()}}`);
		searchUrl.searchParams.set('limit', '200');

		const browseRes = await fetch(searchUrl.toString(), {
			headers: {
				Authorization: `Bearer ${token}`,
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
			}
		});

		if (!browseRes.ok) {
			throw error(502, `eBay Browse API: ${browseRes.status}`);
		}

		const data = await browseRes.json();
		const listings = (data.itemSummaries || []).map(
			(item: {
				itemId: string;
				title: string;
				price?: { value?: string };
				itemWebUrl: string;
				image?: { imageUrl?: string };
			}) => ({
				itemId: item.itemId,
				title: item.title,
				price: item.price?.value ? `$${item.price.value}` : 'N/A',
				url: item.itemWebUrl,
				image: item.image?.imageUrl || null
			})
		);

		return json({ listings, total: listings.length });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('eBay seller listing error:', err);
		throw error(500, 'eBay seller lookup failed');
	}
};
