import { json, error } from '@sveltejs/kit';
import { disconnectSeller } from '$lib/server/ebay-seller-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	await disconnectSeller(user.id);
	return json({ success: true });
};
