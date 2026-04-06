/**
 * PUT /api/admin/feature-flags — Update feature flag settings
 *
 * Admin-only endpoint. Uses server-side auth via admin-guard.
 * Writes via service-role client to bypass RLS (feature_flags has no
 * write policy for the authenticated role by design).
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { parseJsonBody, requireString } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const body = await parseJsonBody(request);
	const feature_key = requireString(body.feature_key, 'feature_key', 100);
	const updates = body.updates as Record<string, unknown>;
	if (!updates || typeof updates !== 'object') {
		throw error(400, 'updates object is required');
	}

	// Use service-role client for writes — the authenticated role has
	// read-only access to feature_flags after RLS is enabled
	const adminClient = getAdminClient();
	if (!adminClient) throw error(503, 'Database not available');

	// Strip non-DB fields that don't belong in the feature_flags table
	const { icon: _icon, ...dbUpdates } = updates;

	const { error: dbError } = await adminClient.from('feature_flags').upsert(
		{
			feature_key,
			display_name: updates.display_name || feature_key,
			...dbUpdates,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'feature_key' }
	);

	if (dbError) {
		console.error('[admin/feature-flags] Upsert error:', dbError);
		throw error(500, 'Failed to update feature flag');
	}

	return json({ success: true });
};
