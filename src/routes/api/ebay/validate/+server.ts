import { json, error } from '@sveltejs/kit';
import { isSellerOAuthConfigured, validateSellerConnection } from '$lib/server/ebay-seller-auth';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429 });
	}

	if (!isSellerOAuthConfigured()) {
		return json({ valid: false, error: 'eBay integration not configured' });
	}

	const result = await validateSellerConnection(user.id);
	return json(result);
};
