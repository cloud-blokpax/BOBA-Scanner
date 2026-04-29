import { error } from '@sveltejs/kit';
import { apiError } from '$lib/server/api-response';
import { json } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/supabase-admin';
import { getStatus } from '$lib/server/wtp/connect-status';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const admin = getAdminClient();
	if (!admin) return apiError('Service unavailable', 503);

	const status = await getStatus(admin, user.id);
	return json(status);
};
