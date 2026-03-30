import { json, error } from '@sveltejs/kit';
import { disconnectSeller } from '$lib/server/ebay-seller-auth';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const user = locals.user;
	if (!user) throw error(401, 'Authentication required');

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	await disconnectSeller(user.id);
	return json({ success: true });
};
