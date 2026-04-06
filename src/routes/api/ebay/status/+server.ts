import { json, error } from '@sveltejs/kit';
import { isSellerOAuthConfigured } from '$lib/server/ebay-seller-auth';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	const configured = isSellerOAuthConfigured();
	if (!configured) return json({ configured, connected: false });

	const admin = getAdminClient();
	if (!admin) return json({ configured, connected: false });

	const { data } = await admin
		.from('ebay_seller_tokens')
		.select('access_token_expires_at, refresh_token_expires_at, scopes, updated_at')
		.eq('user_id', user.id)
		.maybeSingle();

	const now = Date.now();
	const refreshExpiresAt = data ? new Date(data.refresh_token_expires_at).getTime() : 0;
	const accessExpiresAt = data ? new Date(data.access_token_expires_at).getTime() : 0;
	const connected = !!data && refreshExpiresAt > now;

	return json({
		configured,
		connected,
		connected_since: connected && data?.updated_at ? data.updated_at : null,
		token_health: connected ? {
			access_token_valid: accessExpiresAt > now,
			access_token_expires_at: data!.access_token_expires_at,
			refresh_token_expires_at: data!.refresh_token_expires_at,
			refresh_days_remaining: Math.max(0, Math.ceil((refreshExpiresAt - now) / 86_400_000)),
			scopes: data!.scopes ?? null
		} : null
	});
};
