import { error, json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api-response';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import { refreshStripeStatus } from '$lib/server/wtp/connect-status';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const rl = await checkMutationRateLimit(user.id);
	if (!rl.success) return apiError('Too many requests', 429);

	const admin = getAdminClient();
	if (!admin) return apiError('Service unavailable', 503);

	const stripeStatus = await refreshStripeStatus(admin, user.id);
	return json({ ok: true, stripe_connect_status: stripeStatus });
};
