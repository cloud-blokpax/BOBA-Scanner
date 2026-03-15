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
import { getEbayToken, isEbayConfigured } from '$lib/server/ebay-auth';
import { checkAnonScanRateLimit } from '$lib/server/rate-limit';
import { calculatePriceStats } from '$lib/utils/pricing';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const { user } = await locals.safeGetSession();

	// Rate limit anonymous users by IP
	if (!user) {
		const rateLimit = await checkAnonScanRateLimit(getClientAddress());
		if (!rateLimit.success) {
			return json(
				{ error: 'Rate limited. Please wait before trying again.' },
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

	if (!isEbayConfigured()) {
		return json({ error: 'eBay API not configured' }, { status: 503 });
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}
	const seller = typeof body.seller === 'string' ? body.seller : undefined;
	const query = typeof body.query === 'string' ? body.query.slice(0, 200) : undefined;
	const cardNumber = typeof body.cardNumber === 'string' ? body.cardNumber.slice(0, 20) : undefined;
	const hero = typeof body.hero === 'string' ? body.hero.slice(0, 100) : undefined;

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
			const exact = all.filter((item: { title?: string }) => {
				if (!item.title) return false;
				const t = item.title.toUpperCase();
				if (cardNum && t.includes(cardNum)) return true;
				if (heroStr && heroStr.length > 2 && t.includes(heroStr)) return true;
				return false;
			});

			const prices = exact
				.map((item: { price?: { value?: string } }) => parseFloat(item.price?.value ?? ''))
				.filter((p: number) => !isNaN(p) && p > 0);

			const stats = calculatePriceStats(prices);

			return json({
				avgPrice: stats?.median ?? null,
				lowPrice: stats?.low ?? null,
				highPrice: stats?.high ?? null,
				count: stats?.count ?? 0,
				confidence: stats?.confidenceScore ?? 0,
				meanPrice: stats?.mean ?? null,
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

	// Validate seller username: eBay usernames are alphanumeric with dots, hyphens, underscores (max 64 chars)
	const sanitizedSeller = seller.trim();
	if (!/^[\w.\-]{1,64}$/i.test(sanitizedSeller)) {
		throw error(400, 'Invalid seller username');
	}

	try {
		const token = await getEbayToken();
		const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
		searchUrl.searchParams.set('q', 'bo jackson');
		searchUrl.searchParams.set('filter', `sellers:{${sanitizedSeller}}`);
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
