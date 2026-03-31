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
import { isEbayConfigured, ebayFetch } from '$lib/server/ebay-auth';
import { checkEbayDailyLimit } from '$lib/server/redis';
import { getAdminClient } from '$lib/server/supabase-admin';
import { parseJsonBody } from '$lib/server/validate';
import { buildEbaySearchQuery, filterRelevantListings } from '$lib/server/ebay-query';
import { calculatePriceStats } from '$lib/utils/pricing';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Sign in to refresh prices');
	if (!locals.supabase) throw error(503, 'Database not available');
	if (!isEbayConfigured()) throw error(503, 'eBay API not configured');

	const body = await parseJsonBody(request);
	const cardIds = body.card_ids as string[];
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
		.select('is_pro, is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	const isPro = profile?.is_pro || profile?.is_admin || false;
	const rawLimit = isPro
		? Number(memberLimit?.value ?? 10)
		: Number(freeLimit?.value ?? 3);
	let dailyLimit: number = isNaN(rawLimit) ? (isPro ? 10 : 3) : rawLimit;

	// 3. Check per-user override
	const { data: userOverride } = await supabase
		.from('app_config')
		.select('value')
		.eq('key', `deck_shop_limit:${user.id}`)
		.maybeSingle();

	if (userOverride?.value != null) {
		const overrideLimit = Number(userOverride.value);
		if (!isNaN(overrideLimit)) dailyLimit = overrideLimit;
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
			is_pro: isPro
		}, { status: 429 });
	}

	// ── Fetch prices from eBay ──────────────────────────────

	// Check eBay daily API limit before making any calls
	const withinDailyLimit = await checkEbayDailyLimit();
	if (!withinDailyLimit) {
		return json({
			error: 'eBay daily API limit reached. Try again tomorrow.',
			results: [],
			refreshes_remaining: refreshesRemaining,
			limit: dailyLimit,
			is_pro: isPro
		}, { status: 503 });
	}

	// Batch fetch all card metadata in a single query instead of one per card
	const { data: cardsData } = await supabase
		.from('cards')
		.select('id, hero_name, card_number, set_code')
		.in('id', cardIds);

	const cardMap = new Map((cardsData || []).map(c => [c.id, c]));

	// Parallelize eBay API calls (up to 10 concurrent)
	const pricePromises = cardIds.map(async (cardId) => {
		const card = cardMap.get(cardId);
		if (!card) return null;

		try {
			const query = buildEbaySearchQuery(card);
			const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
			searchUrl.searchParams.set('q', query);
			searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
			searchUrl.searchParams.set('limit', '50');

			const browseRes = await ebayFetch(searchUrl.toString());

			if (!browseRes.ok) return null;

			const data = await browseRes.json();
			const rawItems: Array<{ title?: string; price?: { value?: string } }> = data.itemSummaries || [];

			// Filter to relevant listings using shared logic
			const relevant = filterRelevantListings(rawItems, card);

			const prices = relevant
				.map(item => parseFloat(item.price?.value ?? ''))
				.filter((p: number) => !isNaN(p) && p > 0);

			const stats = calculatePriceStats(prices);

			const priceData = {
				card_id: cardId,
				source: 'ebay',
				price_low: stats?.low ?? null,
				price_mid: stats?.median ?? null,
				price_high: stats?.high ?? null,
				listings_count: stats?.count ?? 0,
				filtered_count: stats?.filteredCount ?? 0,
				confidence_score: stats?.confidenceScore ?? 0,
				fetched_at: new Date().toISOString()
			};

			const cacheClient = getAdminClient() || supabase;
			await cacheClient.from('price_cache').upsert(priceData, { onConflict: 'card_id,source' });

			return {
				card_id: cardId,
				price_mid: stats?.median ?? null,
				price_low: stats?.low ?? null,
				price_high: stats?.high ?? null,
				listings_count: stats?.count ?? 0
			};
		} catch (err) {
			console.debug(`[deck/refresh-prices] Failed for ${cardId}:`, err);
			return null;
		}
	});

	const settled = await Promise.all(pricePromises);
	const results = settled.filter(Boolean);

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
		is_pro: isPro
	});
};
