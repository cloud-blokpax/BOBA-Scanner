import { error, json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api-response';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const admin = getAdminClient();
	if (!admin) return apiError('Service unavailable', 503);

	const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

	const { data, error: dbErr } = await admin
		.from('wtp_postings')
		.select(
			`id, status, posted_at, last_synced_at, wtp_listing_id, wtp_listing_url,
			 error_message, payload, scan_id, source_listing_id,
			 card:cards(id, name, card_number, parallel, set_code)`
		)
		.eq('user_id', user.id)
		.order('created_at', { ascending: false })
		.limit(limit);

	if (dbErr) return apiError(dbErr.message, 500);

	return json({ postings: data ?? [] });
};
