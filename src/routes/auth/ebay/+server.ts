import { redirect } from '@sveltejs/kit';
import { buildAuthUrl, isSellerOAuthConfigured } from '$lib/server/ebay-seller-auth';
import type { RequestHandler } from './$types';
import crypto from 'crypto';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/auth/login?redirectTo=' + encodeURIComponent('/settings?ebay=setup'));
	if (!isSellerOAuthConfigured()) throw redirect(303, '/settings?ebay=not_configured');

	const state = crypto.randomBytes(32).toString('hex');
	cookies.set('ebay_oauth_state', state, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });
	throw redirect(302, buildAuthUrl(state));
};
