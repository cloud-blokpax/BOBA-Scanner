/**
 * GET /api/admin/card-health — Card metrics for admin Cards tab
 *
 * Returns price_cache counts, scan flag counts, and pending flags list.
 * Uses service-role client to bypass RLS on price_cache / scan_disputes.
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

	// scan_disputes isn't in database.ts yet (Phase 0.5 regeneration pending)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const adminUntyped = admin as any;
	const [cardsRes, pricesRes, stalePricesRes, flagsCountRes, flagsRes] = await Promise.all([
		admin.from('cards').select('id', { count: 'exact', head: true }),
		admin.from('price_cache').select('id', { count: 'exact', head: true }),
		admin.from('price_cache').select('id', { count: 'exact', head: true })
			.lt('fetched_at', sevenDaysAgo.toISOString()),
		adminUntyped.from('scan_disputes').select('id', { count: 'exact', head: true })
			.eq('resolution', 'pending'),
		adminUntyped.from('scan_disputes').select('*')
			.eq('resolution', 'pending')
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
