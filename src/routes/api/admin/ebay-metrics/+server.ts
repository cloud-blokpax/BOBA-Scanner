/**
 * GET /api/admin/ebay-metrics — eBay metrics for admin eBay tab
 *
 * Returns eBay API quota, price cache counts, and stale price counts.
 * Uses service-role client to bypass RLS on ebay_api_log / price_cache.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const [quotaRes, pricesRes, staleRes] = await Promise.all([
		admin.from('ebay_api_log')
			.select('calls_remaining, calls_limit, reset_at, status, chain_depth, cards_processed, cards_updated, recorded_at')
			.order('recorded_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
		admin.from('price_cache').select('id', { count: 'exact', head: true }),
		admin.from('price_cache').select('id', { count: 'exact', head: true })
			.lt('fetched_at', new Date(Date.now() - 7 * 86400000).toISOString())
	]);

	// Try the RPC first; fall back to direct queries if the function isn't deployed yet
	let priceStatus: Array<{
		card_type: string;
		has_price: number;
		searched_no_price: number;
		not_searched: number;
		total: number;
	}> = [];

	const rpcRes = await admin.rpc('get_price_status_summary');
	if (rpcRes.data && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
		priceStatus = rpcRes.data;
	} else {
		// Fallback: query counts directly from tables
		const [heroTotal, playTotal, hotdogTotal, heroPriced, heroSearched, playPriced, playSearched, hotdogPriced, hotdogSearched] = await Promise.all([
			// Totals
			admin.from('cards').select('id', { count: 'exact', head: true }),
			admin.from('play_cards').select('id', { count: 'exact', head: true })
				.or('card_number.like.PL-%,card_number.like.BPL-%'),
			admin.from('play_cards').select('id', { count: 'exact', head: true })
				.like('card_number', 'HTD-%'),
			// Heroes with price (join via price_cache)
			admin.from('price_cache').select('card_id', { count: 'exact', head: true })
				.eq('source', 'ebay')
				.not('price_mid', 'is', null)
				.not('card_id', 'like', '%-%-%-%-%'),  // Exclude UUIDs (play cards)
			// Heroes searched but no price
			admin.from('price_cache').select('card_id', { count: 'exact', head: true })
				.eq('source', 'ebay')
				.is('price_mid', null)
				.not('card_id', 'like', '%-%-%-%-%'),
			// Plays with price
			admin.from('price_cache').select('card_id', { count: 'exact', head: true })
				.eq('source', 'ebay')
				.not('price_mid', 'is', null)
				.like('card_id', '%-%-%-%-%'),
			// Plays searched but no price — we can't distinguish play vs hotdog here easily,
			// so we count all UUID-shaped card_ids with null price_mid
			admin.from('price_cache').select('card_id', { count: 'exact', head: true })
				.eq('source', 'ebay')
				.is('price_mid', null)
				.like('card_id', '%-%-%-%-%'),
			// Hotdog priced — not distinguishable in fallback without join, use 0
			Promise.resolve({ count: 0 }),
			Promise.resolve({ count: 0 })
		]);

		const hTotal = heroTotal.count || 0;
		const hPriced = heroPriced.count || 0;
		const hSearched = heroSearched.count || 0;

		const pTotal = playTotal.count || 0;
		// In fallback, play+hotdog priced are mixed; attribute all to plays
		const pPriced = playPriced.count || 0;
		const pSearched = playSearched.count || 0;

		const hdTotal = hotdogTotal.count || 0;
		const hdPriced = (hotdogPriced as { count: number }).count || 0;
		const hdSearched = (hotdogSearched as { count: number }).count || 0;

		priceStatus = [
			{
				card_type: 'heroes',
				has_price: hPriced,
				searched_no_price: hSearched,
				not_searched: hTotal - hPriced - hSearched,
				total: hTotal
			},
			{
				card_type: 'plays',
				has_price: pPriced,
				searched_no_price: pSearched,
				not_searched: pTotal - pPriced - pSearched,
				total: pTotal
			},
			{
				card_type: 'hotdogs',
				has_price: hdPriced,
				searched_no_price: hdSearched,
				not_searched: hdTotal - hdPriced - hdSearched,
				total: hdTotal
			}
		];
	}

	return json({
		callsRemaining: quotaRes.data?.calls_remaining ?? null,
		callsLimit: quotaRes.data?.calls_limit ?? null,
		resetAt: quotaRes.data?.reset_at ?? null,
		totalPrices: pricesRes.count || 0,
		stalePrices: staleRes.count || 0,
		priceStatus
	});
};
