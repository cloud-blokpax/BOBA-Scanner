import { redirect, error } from '@sveltejs/kit';
import { buildAuthUrl, isSellerOAuthConfigured } from '$lib/server/ebay-seller-auth';
import type { RequestHandler } from './$types';
import crypto from 'crypto';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw redirect(303, '/auth/login?redirectTo=/settings');
	if (!isSellerOAuthConfigured()) throw redirect(303, '/settings?ebay=not_configured');

	const state = crypto.randomBytes(32).toString('hex');
	cookies.set('ebay_oauth_state', state, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });
	throw redirect(302, buildAuthUrl(state));
};
