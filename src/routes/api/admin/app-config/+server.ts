/**
 * /api/admin/app-config — App configuration management
 *
 * GET: Read config values by keys
 * PUT: Save config values
 *
 * Uses service-role client to bypass RLS on app_config.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { parseJsonBody } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const keys = url.searchParams.get('keys')?.split(',').filter(Boolean) || [];
	if (keys.length === 0) throw error(400, 'keys parameter required');

	const { data, error: dbError } = await admin
		.from('app_config')
		.select('key, value')
		.in('key', keys);

	if (dbError) {
		console.error('[admin/app-config] GET error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	return json({ config: data || [] });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);

	const { user } = await locals.safeGetSession();
	const rateLimit = await checkMutationRateLimit(user!.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const body = await parseJsonBody<Record<string, unknown>>(request);
	const entries = body.entries as Array<{ key: string; value: unknown }>;
	if (!Array.isArray(entries) || entries.length === 0) {
		throw error(400, 'entries array required');
	}

	const { error: dbError } = await admin.from('app_config').upsert(
		entries.map((e) => ({
			key: e.key,
			value: e.value,
			updated_at: new Date().toISOString()
		})),
		{ onConflict: 'key' }
	);

	if (dbError) {
		console.error('[admin/app-config] PUT error:', dbError.message);
		throw error(500, 'Failed to save config');
	}

	return json({ success: true });
};
