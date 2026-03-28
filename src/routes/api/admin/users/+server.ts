/**
 * /api/admin/users — Enhanced user management
 *
 * GET:  List all users (admin only, bypasses RLS via service role)
 * PUT:  Update user role/status
 * POST: Bulk operations on users
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { parseJsonBody } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) {
		// Fall back to user's own Supabase client if service role unavailable
		// This will be limited by RLS but is better than a 503
		if (!locals.supabase) throw error(503, 'Database not available');

		const { data } = await locals.supabase
			.from('users')
			.select('id, auth_user_id, email, name, is_admin, is_pro, api_calls_used, cards_in_collection, created_at')
			.order('created_at', { ascending: false })
			.limit(500);

		return json((data ?? []).map((u: Record<string, unknown>) => ({ ...u, is_organizer: false })));
	}

	// Try with all columns first; fall back to base columns if is_organizer doesn't exist
	let { data, error: dbError } = await admin
		.from('users')
		.select('id, auth_user_id, email, name, is_admin, is_pro, is_organizer, api_calls_used, cards_in_collection, created_at')
		.order('created_at', { ascending: false })
		.limit(500);

	if (dbError) {
		// is_organizer may not exist if migration 005 hasn't been applied
		const fallback = await admin
			.from('users')
			.select('id, auth_user_id, email, name, is_admin, is_pro, api_calls_used, cards_in_collection, created_at')
			.order('created_at', { ascending: false })
			.limit(500);

		if (fallback.error) throw error(500, fallback.error.message);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		data = (fallback.data ?? []).map((u: any) => ({ ...u, is_organizer: false }));
	}

	return json(data ?? []);
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const { user } = await locals.safeGetSession();
	const rateLimit = await checkMutationRateLimit(user!.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const body = await parseJsonBody<Record<string, unknown>>(request);
	const { user_id, updates } = body as { user_id?: string; updates?: Record<string, unknown> };

	if (!user_id) throw error(400, 'user_id is required');
	if (!updates || typeof updates !== 'object') throw error(400, 'updates object is required');

	const allowed = ['is_pro', 'is_organizer', 'is_admin', 'card_limit', 'api_calls_limit'];
	const safeUpdates: Record<string, unknown> = {};
	for (const key of allowed) {
		if (updates[key] !== undefined) safeUpdates[key] = updates[key];
	}

	if (Object.keys(safeUpdates).length === 0) throw error(400, 'No valid updates provided');

	const { error: dbError } = await admin
		.from('users')
		.update(safeUpdates)
		.eq('auth_user_id', user_id);

	if (dbError) throw error(500, dbError.message);

	// Log admin action
	await admin.from('admin_activity_log').insert({
		admin_id: user!.id,
		action: 'update_user',
		entity_type: 'user',
		entity_id: user_id,
		details: safeUpdates
	});

	return json({ success: true });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const { user } = await locals.safeGetSession();
	const rateLimit = await checkMutationRateLimit(user!.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const body = await parseJsonBody<Record<string, unknown>>(request);
	const { action, user_ids, updates } = body as { action?: string; user_ids?: string[]; updates?: Record<string, unknown> };

	if (!Array.isArray(user_ids) || user_ids.length === 0) {
		throw error(400, 'user_ids array is required');
	}

	switch (action) {
		case 'update_role': {
			const allowed = ['is_pro', 'is_organizer'];
			const safeUpdates: Record<string, unknown> = {};
			for (const key of allowed) {
				if (updates?.[key] !== undefined) safeUpdates[key] = updates[key];
			}
			if (Object.keys(safeUpdates).length === 0) throw error(400, 'No valid updates');

			const { error: dbError } = await admin
				.from('users')
				.update(safeUpdates)
				.in('auth_user_id', user_ids);

			if (dbError) throw error(500, dbError.message);

			await admin.from('admin_activity_log').insert({
				admin_id: user!.id,
				action: 'bulk_update_users',
				entity_type: 'user',
				details: { user_ids, updates: safeUpdates }
			});

			return json({ success: true, affected: user_ids.length });
		}
		default:
			throw error(400, `Unknown bulk action: ${action}`);
	}
};
