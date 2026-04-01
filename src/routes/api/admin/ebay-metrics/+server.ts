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
		// Fallback: fetch play_cards ids + card_numbers and price_cache entries,
		// then cross-reference in JS to avoid unreliable pattern matching.
		const [heroTotalRes, playCardsRes, priceCacheRes] = await Promise.all([
			admin.from('cards').select('id', { count: 'exact', head: true }),
			admin.from('play_cards').select('id, card_number'),
			admin.from('price_cache').select('card_id, price_mid').eq('source', 'ebay')
		]);

		// Build lookup sets from play_cards
		const playIds = new Set<string>();
		const hotdogIds = new Set<string>();
		for (const pc of playCardsRes.data ?? []) {
			const id = pc.id as string;
			const cn = pc.card_number as string;
			if (cn.startsWith('HTD-') || cn.startsWith('HTD')) {
				hotdogIds.add(id);
			} else {
				playIds.add(id);
			}
		}

		// Tally price_cache entries by card type
		let heroPriced = 0, heroSearched = 0;
		let playPriced = 0, playSearched = 0;
		let hdPriced = 0, hdSearched = 0;

		for (const row of priceCacheRes.data ?? []) {
			const cid = row.card_id as string;
			const hasMid = row.price_mid != null;

			if (playIds.has(cid)) {
				if (hasMid) playPriced++; else playSearched++;
			} else if (hotdogIds.has(cid)) {
				if (hasMid) hdPriced++; else hdSearched++;
			} else {
				// Must be a hero card
				if (hasMid) heroPriced++; else heroSearched++;
			}
		}

		const hTotal = heroTotalRes.count || 0;
		const pTotal = playIds.size;
		const hdTotal = hotdogIds.size;

		priceStatus = [
			{
				card_type: 'heroes',
				has_price: heroPriced,
				searched_no_price: heroSearched,
				not_searched: hTotal - heroPriced - heroSearched,
				total: hTotal
			},
			{
				card_type: 'plays',
				has_price: playPriced,
				searched_no_price: playSearched,
				not_searched: pTotal - playPriced - playSearched,
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
