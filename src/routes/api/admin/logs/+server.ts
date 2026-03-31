/**
 * GET /api/admin/logs — Recent API call logs
 *
 * Uses service-role client to bypass RLS on api_call_logs.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

	const { data, error: dbError } = await admin
		.from('api_call_logs')
		.select('id, user_id, call_type, error_message, success, created_at')
		.order('created_at', { ascending: false })
		.limit(limit);

	if (dbError) {
		console.error('[admin/logs] GET error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	return json({ logs: data || [] });
};
