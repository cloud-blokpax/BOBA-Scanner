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

	const [quotaRes, pricesRes, staleRes, statusRes] = await Promise.all([
		admin.from('ebay_api_log')
			.select('calls_remaining, calls_limit, reset_at, status, chain_depth, cards_processed, cards_updated, recorded_at')
			.order('recorded_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
		admin.from('price_cache').select('id', { count: 'exact', head: true }),
		admin.from('price_cache').select('id', { count: 'exact', head: true })
			.lt('fetched_at', new Date(Date.now() - 7 * 86400000).toISOString()),
		admin.rpc('get_price_status_summary')
	]);

	return json({
		callsRemaining: quotaRes.data?.calls_remaining ?? null,
		callsLimit: quotaRes.data?.calls_limit ?? null,
		resetAt: quotaRes.data?.reset_at ?? null,
		totalPrices: pricesRes.count || 0,
		stalePrices: staleRes.count || 0,
		priceStatus: statusRes.data ?? []
	});
};
