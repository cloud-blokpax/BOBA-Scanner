/**
 * GET /api/admin/st-data?card_id=UUID
 *
 * Returns scraping test pricing data for a single card.
 * Admin-only — uses requireAdmin guard + RLS double protection.
 *
 * Response: { data: { st_price, st_low, st_high, st_card_name, ... } | null }
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
		.from('scraping_test')
		.select(`
			st_price,
			st_low,
			st_high,
			st_source_id,
			st_card_name,
			st_set_name,
			st_variant,
			st_rarity,
			st_image_url,
			st_raw_data,
			st_updated
		`)
		.eq('card_id', cardId)
		.maybeSingle();

	if (dbErr) {
		console.error('[st-data] Query failed:', dbErr);
		throw error(500, 'Query failed');
	}

	return json({ data: data || null });
};
