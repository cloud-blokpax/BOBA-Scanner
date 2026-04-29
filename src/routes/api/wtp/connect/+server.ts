import { error, json } from '@sveltejs/kit';
import { apiError } from '$lib/server/api-response';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import { isWtpConfigured, verifyAndStoreToken } from '$lib/server/wtp/auth';
import { isCryptoConfigured } from '$lib/server/wtp/crypto';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const rl = await checkMutationRateLimit(user.id);
	if (!rl.success) return apiError('Too many requests', 429);

	if (!isWtpConfigured() || !isCryptoConfigured()) {
		return apiError('WTP integration is not configured on the server', 503);
	}

	const admin = getAdminClient();
	if (!admin) return apiError('Service unavailable', 503);

	const body = (await request.json().catch(() => ({}))) as { token?: string };
	const token = (body.token ?? '').trim();
	if (!token) return apiError('Missing token', 400);

	const result = await verifyAndStoreToken(admin, user.id, token);
	if (!result.ok) return apiError(result.error ?? 'Token verification failed', 400);

	return json({
		ok: true,
		wtp_username: result.wtp_username ?? null,
		stripe_connect_status: result.stripe_connect_status ?? null
	});
};
