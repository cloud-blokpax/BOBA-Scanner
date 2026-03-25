import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { requireString } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);

	const body = await request.json();
	const userId = requireString(body.user_id, 'user_id');
	const isOrganizer = body.is_organizer === true;

	const adminClient = getAdminClient();
	if (!adminClient) throw error(503, 'Admin client not available');

	const { error: updateErr } = await adminClient
		.from('users')
		.update({ is_organizer: isOrganizer })
		.eq('auth_user_id', userId);

	if (updateErr) throw error(500, 'Failed to update organizer status');

	return json({ success: true, is_organizer: isOrganizer });
};
