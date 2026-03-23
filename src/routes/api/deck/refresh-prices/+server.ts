/**
 * POST /api/deck/refresh-prices — Batch refresh eBay prices for deck gap cards
 *
 * Rate limited per user:
 *   - Free users: 3 refreshes/day (each refresh = up to 10 cards)
 *   - Members: 10 refreshes/day
 *   - Per-user overrides via app_config key 'deck_shop_limit:<user_id>'
 *
 * Admin-editable via app_config table:
 *   - deck_shop_daily_refreshes_free (default: 3)
 *   - deck_shop_daily_refreshes_member (default: 10)
 */

import { json, error } from '@sveltejs/kit';
import { getEbayToken, isEbayConfigured } from '$lib/server/ebay-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Sign in to refresh prices');
	if (!locals.supabase) throw error(503, 'Database not available');
	if (!isEbayConfigured()) throw error(503, 'eBay API not configured');

	// Parse request
	let body: { card_ids: string[] };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const cardIds = body.card_ids;
	if (!Array.isArray(cardIds) || cardIds.length === 0 || cardIds.length > 10) {
		throw error(400, 'card_ids must be an array of 1-10 card IDs');
	}

	// ── Check daily refresh budget ──────────────────────────
	const supabase = locals.supabase;

	// 1. Get global limits from app_config
	const { data: freeLimit } = await supabase
		.from('app_config')
		.select('value')
		.eq('key', 'deck_shop_daily_refreshes_free')
		.maybeSingle();

	const { data: memberLimit } = await supabase
		.from('app_config')
		.select('value')
		.eq('key', 'deck_shop_daily_refreshes_member')
		.maybeSingle();

	// 2. Check if user is a member
	const { data: profile } = await supabase
		.from('users')
		.select('is_member, is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	const isMember = profile?.is_member || profile?.is_admin || false;
	let dailyLimit: number = isMember
		? Number(memberLimit?.value ?? 10)
		: Number(freeLimit?.value ?? 3);

	// 3. Check per-user override
	const { data: userOverride } = await supabase
		.from('app_config')
		.select('value')
		.eq('key', `deck_shop_limit:${user.id}`)
		.maybeSingle();

	if (userOverride?.value != null) {
		dailyLimit = Number(userOverride.value);
	}

	// 4. Count today's refreshes for this user
	const todayStart = new Date();
	todayStart.setUTCHours(0, 0, 0, 0);

	const { count: todayCount } = await supabase
		.from('deck_shop_refresh_log')
		.select('*', { count: 'exact', head: true })
		.eq('user_id', user.id)
		.gte('created_at', todayStart.toISOString());

	const refreshesUsed = todayCount || 0;
	const refreshesRemaining = Math.max(0, Number(dailyLimit) - refreshesUsed);

	if (refreshesRemaining <= 0) {
		return json({
			error: 'Daily refresh limit reached',
			limit: Number(dailyLimit),
			used: refreshesUsed,
			resets_at: new Date(todayStart.getTime() + 86400_000).toISOString(),
			is_member: isMember
		}, { status: 429 });
	}

	// ── Fetch prices from eBay ──────────────────────────────
	const results: Array<{
		card_id: string;
		price_mid: number | null;
		price_low: number | null;
		price_high: number | null;
		listings_count: number;
	}> = [];

	const token = await getEbayToken();

	for (const cardId of cardIds) {
		try {
			// Get card metadata for eBay search query
			const { data: card } = await supabase
				.from('cards')
				.select('hero_name, card_number, set_code')
				.eq('id', cardId)
				.maybeSingle();

			if (!card) continue;

			// Build search query
			const query = ['BoBA', card.hero_name, card.card_number].filter(Boolean).join(' ');

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

			if (!browseRes.ok) continue;

			const data = await browseRes.json();
			const items = data.itemSummaries || [];
			const cardNum = (card.card_number || '').toUpperCase();
			const normalizedCardNum = cardNum.replace(/[-\s]/g, '');

			// Filter to relevant listings (normalize spaces/hyphens for variants like "BF 108" vs "BF-108")
			const relevant = items.filter((item: { title?: string }) => {
				if (!normalizedCardNum) return false;
				const normalizedTitle = (item.title || '').toUpperCase().replace(/[-\s]/g, '');
				return normalizedTitle.includes(normalizedCardNum);
			});

			const prices = relevant
				.map((item: { price?: { value?: string } }) => parseFloat(item.price?.value ?? ''))
				.filter((p: number) => !isNaN(p) && p > 0)
				.sort((a: number, b: number) => a - b);

			const priceMid = prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null;
			const priceLow = prices.length > 0 ? prices[0] : null;
			const priceHigh = prices.length > 0 ? prices[prices.length - 1] : null;

			// Update the price cache
			const priceData = {
				card_id: cardId,
				source: 'ebay',
				price_low: priceLow,
				price_mid: priceMid,
				price_high: priceHigh,
				listings_count: prices.length,
				fetched_at: new Date().toISOString()
			};

			await supabase.from('price_cache').upsert(priceData, { onConflict: 'card_id,source' });

			results.push({
				card_id: cardId,
				price_mid: priceMid,
				price_low: priceLow,
				price_high: priceHigh,
				listings_count: prices.length
			});
		} catch (err) {
			console.debug(`[deck/refresh-prices] Failed for ${cardId}:`, err);
		}
	}

	// Log this refresh for rate limiting
	await supabase.from('deck_shop_refresh_log').insert({
		user_id: user.id,
		card_count: cardIds.length,
		created_at: new Date().toISOString()
	});

	return json({
		results,
		refreshes_remaining: refreshesRemaining - 1,
		limit: Number(dailyLimit),
		is_member: isMember
	});
};
