import { json, error } from '@sveltejs/kit';
import { isSellerOAuthConfigured, isSellerConnected } from '$lib/server/ebay-seller-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const configured = isSellerOAuthConfigured();
	const connected = configured ? await isSellerConnected(user.id) : false;

	return json({ configured, connected });
};
