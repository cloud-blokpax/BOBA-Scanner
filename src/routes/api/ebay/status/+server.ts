import { json, error } from '@sveltejs/kit';
import { isSellerOAuthConfigured } from '$lib/server/ebay-seller-auth';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Authentication required');

	const configured = isSellerOAuthConfigured();
	if (!configured) return json({ configured, connected: false });

	const admin = getAdminClient();
	if (!admin) return json({ configured, connected: false });

	const { data } = await admin
		.from('ebay_seller_tokens')
		.select('refresh_token_expires_at, updated_at')
		.eq('user_id', user.id)
		.maybeSingle();

	const connected = !!data && new Date(data.refresh_token_expires_at).getTime() > Date.now();

	return json({
		configured,
		connected,
		connected_since: connected && data?.updated_at ? data.updated_at : null
	});
};
