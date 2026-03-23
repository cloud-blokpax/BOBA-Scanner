/**
 * PUT /api/admin/feature-flags — Update feature flag settings
 *
 * Admin-only endpoint. Uses server-side auth via admin-guard.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);

	const { feature_key, updates } = await request.json();
	if (!feature_key || !updates) {
		throw error(400, 'feature_key and updates are required');
	}

	if (!locals.supabase) throw error(503, 'Database not available');

	// Strip non-DB fields
	const { icon: _icon, ...dbUpdates } = updates;

	const { error: dbError } = await locals.supabase.from('feature_flags').upsert(
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
