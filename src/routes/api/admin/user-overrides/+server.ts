/**
 * /api/admin/user-overrides — Per-user feature flag overrides
 *
 * GET: List overrides with user emails
 * POST: Add/update an override
 * DELETE: Remove an override
 *
 * Uses service-role client to bypass RLS on user_feature_overrides.
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
	if (!admin) throw error(503, 'Database not available');

	const { data, error: dbError } = await admin
		.from('user_feature_overrides')
		.select('user_id, feature_key, enabled')
		.order('feature_key', { ascending: true })
		.limit(200);

	if (dbError) {
		console.error('[admin/user-overrides] GET error:', dbError.message);
		throw error(500, `Database operation failed: ${dbError.message}`);
	}

	// Resolve user emails
	const userIds = [...new Set((data || []).map((d: { user_id: string }) => d.user_id))];
	let emailMap = new Map<string, string>();
	if (userIds.length > 0) {
		const { data: userRows } = await admin
			.from('users')
			.select('id, email')
			.in('id', userIds);
		emailMap = new Map((userRows || []).map((u: { id: string; email: string }) => [u.id, u.email]));
	}

	const overrides = (data || []).map((d: { user_id: string; feature_key: string; enabled: boolean }) => ({
		...d,
		user_email: emailMap.get(d.user_id) || d.user_id
	}));

	return json({ overrides });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const body = await parseJsonBody<Record<string, unknown>>(request);
	let userId = (body.user_id as string || '').trim();
	const featureKey = body.feature_key as string;
	const enabled = body.enabled as boolean;

	if (!userId || !featureKey) throw error(400, 'user_id and feature_key required');

	// Resolve email to UUID if needed
	if (!userId.match(/^[0-9a-f-]{36}$/i)) {
		const { data: userRow } = await admin
			.from('users')
			.select('id')
			.eq('email', userId)
			.maybeSingle();
		if (!userRow) throw error(404, 'User not found');
		userId = userRow.id;
	}

	const { error: dbError } = await admin.from('user_feature_overrides').upsert(
		{ user_id: userId, feature_key: featureKey, enabled, updated_at: new Date().toISOString() },
		{ onConflict: 'user_id,feature_key' }
	);

	if (dbError) {
		console.error('[admin/user-overrides] POST error:', dbError.message);
		throw error(500, 'Failed to save override');
	}

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const body = await parseJsonBody<Record<string, unknown>>(request);
	const userId = body.user_id as string;
	const featureKey = body.feature_key as string;

	if (!userId || !featureKey) throw error(400, 'user_id and feature_key required');

	const { error: dbError } = await admin
		.from('user_feature_overrides')
		.delete()
		.eq('user_id', userId)
		.eq('feature_key', featureKey);

	if (dbError) {
		console.error('[admin/user-overrides] DELETE error:', dbError.message);
		throw error(500, 'Failed to remove override');
	}

	return json({ success: true });
};
