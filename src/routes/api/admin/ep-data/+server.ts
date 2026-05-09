/**
 * GET /api/admin/ep-data?card_id=UUID
 *
 * Returns external pricing data for a single card.
 * Admin-only — uses requireAdmin guard + RLS double protection.
 *
 * Response: { data: { ep_price, ep_low, ep_high, ep_card_name, ... } | null }
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const cardId = url.searchParams.get('card_id');
	if (!cardId) throw error(400, 'card_id required');

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const { data, error: dbErr } = await admin
		.from('external_pricing')
		.select(`
			ep_price,
			ep_low,
			ep_high,
			ep_source_id,
			ep_card_name,
			ep_set_name,
			ep_variant,
			ep_rarity,
			ep_image_url,
			ep_raw_data,
			ep_updated
		`)
		.eq('card_id', cardId)
		.maybeSingle();

	if (dbErr) {
		console.error('[ep-data] Query failed:', dbErr);
		throw error(500, 'Query failed');
	}

	return json({ data: data || null });
};
