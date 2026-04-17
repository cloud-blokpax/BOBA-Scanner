/**
 * GET /api/admin/card-health — Card metrics for admin Cards tab
 *
 * Returns price_cache counts, scan flag counts, and pending flags list.
 * Uses service-role client to bypass RLS on price_cache / scan_flags.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const sevenDaysAgo = new Date();
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

	const [cardsRes, pricesRes, stalePricesRes, flagsCountRes, flagsRes] = await Promise.all([
		admin.from('cards').select('id', { count: 'exact', head: true }),
		admin.from('price_cache').select('id', { count: 'exact', head: true }),
		admin.from('price_cache').select('id', { count: 'exact', head: true })
			.lt('fetched_at', sevenDaysAgo.toISOString()),
		admin.from('scan_flags').select('id', { count: 'exact', head: true })
			.eq('status', 'pending'),
		admin.from('scan_flags').select('*')
			.eq('status', 'pending')
			.order('created_at', { ascending: false })
			.limit(50)
	]);

	return json({
		metrics: {
			totalCards: cardsRes.count || 0,
			withPrices: pricesRes.count || 0,
			stalePrices: stalePricesRes.count || 0,
			pendingFlags: flagsCountRes.count || 0
		},
		flags: flagsRes.data || []
	});
};
