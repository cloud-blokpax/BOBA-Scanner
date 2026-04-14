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

/** Paginate through all rows of a Supabase query, collecting card_ids into a Set.
 *  Uses 1,000-row chunks to stay within Supabase/PostgREST default row limit. */
async function fetchAllCardIds(
	admin: ReturnType<typeof getAdminClient> & object,
	table: string
): Promise<Set<string>> {
	const ids = new Set<string>();
	const CHUNK = 1000;
	let offset = 0;
	let done = false;

	while (!done) {
		const { data } = await admin.from(table).select('card_id').range(offset, offset + CHUNK - 1);
		if (!data || data.length === 0) {
			done = true;
		} else {
			for (const row of data) {
				ids.add((row as { card_id: string }).card_id);
			}
			offset += CHUNK;
			if (data.length < CHUNK) done = true;
		}
	}
	return ids;
}

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
		admin.from('price_cache').select('card_id', { count: 'exact', head: true }).eq('source', 'ebay'),
		admin.from('price_cache').select('card_id', { count: 'exact', head: true })
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
		priceStatus = rpcRes.data as unknown as typeof priceStatus;
	} else {
		// Fallback: fetch play_cards, price_cache, and harvest log entries,
		// then cross-reference in JS. Cards searched by the harvester but
		// rejected by the confidence threshold only appear in price_harvest_log,
		// not in price_cache, so we need both sources.
		//
		// We paginate price_cache and price_harvest_log to avoid Supabase's
		// default 1000-row limit and handle tables with 100K+ rows.
		const CHUNK = 1000;
		const [heroTotalRes, playCardsRes, priceCacheRows, harvestCardIds] = await Promise.all([
			admin.from('cards').select('id', { count: 'exact', head: true }),
			// Paginate play_cards in 1k chunks (Supabase caps at 1,000 rows)
			(async () => {
				const rows: Array<{ id: string; card_number: string }> = [];
				let offset = 0;
				let done = false;
				while (!done) {
					const { data } = await admin.from('play_cards')
						.select('id, card_number')
						.range(offset, offset + CHUNK - 1);
					if (!data || data.length === 0) {
						done = true;
					} else {
						for (const r of data) rows.push(r as { id: string; card_number: string });
						offset += CHUNK;
						if (data.length < CHUNK) done = true;
					}
				}
				return { data: rows };
			})(),
			// Paginate price_cache in 1k chunks (hero cards)
			(async () => {
				const rows: Array<{ card_id: string; price_mid: number | null }> = [];
				let offset = 0;
				let done = false;
				while (!done) {
					const { data } = await admin.from('price_cache')
						.select('card_id, price_mid')
						.eq('source', 'ebay')
						.range(offset, offset + CHUNK - 1);
					if (!data || data.length === 0) {
						done = true;
					} else {
						for (const r of data) rows.push(r as { card_id: string; price_mid: number | null });
						offset += CHUNK;
						if (data.length < CHUNK) done = true;
					}
				}
				// Also fetch play_price_cache (play cards + hot dogs — usually <500 rows)
				const { data: playPrices } = await admin.from('play_price_cache')
					.select('card_id, price_mid')
					.eq('source', 'ebay');
				if (playPrices) {
					for (const r of playPrices) rows.push(r as { card_id: string; price_mid: number | null });
				}
				return rows;
			})(),
			// Paginate harvest log — only need distinct card_ids
			fetchAllCardIds(admin, 'price_harvest_log')
		]);

		// Build lookup sets from play_cards
		const playIds = new Set<string>();
		const hotdogIds = new Set<string>();
		for (const pc of playCardsRes.data ?? []) {
			const id = pc.id as string;
			const cn = pc.card_number as string;
			if (cn.startsWith('HTD')) {
				hotdogIds.add(id);
			} else {
				playIds.add(id);
			}
		}

		// Track all cards that appear in price_cache, keyed by card_id
		// Value: true = has price, false = searched but no price
		const cacheStatus = new Map<string, boolean>();
		for (const row of priceCacheRows) {
			cacheStatus.set(row.card_id, row.price_mid != null);
		}

		// Tally by card type
		let heroPriced = 0, heroSearched = 0;
		let playPriced = 0, playSearched = 0;
		let hdPriced = 0, hdSearched = 0;

		// Count from price_cache
		for (const [cid, hasMid] of cacheStatus) {
			if (playIds.has(cid)) {
				if (hasMid) playPriced++; else playSearched++;
			} else if (hotdogIds.has(cid)) {
				if (hasMid) hdPriced++; else hdSearched++;
			} else {
				if (hasMid) heroPriced++; else heroSearched++;
			}
		}

		// Count harvest-only cards (searched but threshold-rejected → "searched, no price")
		for (const cid of harvestCardIds) {
			if (cacheStatus.has(cid)) continue; // Already counted above
			if (playIds.has(cid)) {
				playSearched++;
			} else if (hotdogIds.has(cid)) {
				hdSearched++;
			} else {
				heroSearched++;
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
