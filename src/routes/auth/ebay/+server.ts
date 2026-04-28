import { redirect } from '@sveltejs/kit';
import { buildAuthUrl, isSellerOAuthConfigured } from '$lib/server/ebay-seller-auth';
import { signState, sanitizeReturnTo } from '$lib/server/auth/oauth-state';
import type { RequestHandler } from './$types';
import crypto from 'crypto';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/auth/login?redirectTo=' + encodeURIComponent('/settings?ebay=setup'));
	if (!isSellerOAuthConfigured()) throw redirect(303, '/settings?ebay=not_configured');

	// Capture where the user came from so the callback can land them back there.
	// Defaults to /settings (the historical landing page) if not provided.
	const returnTo = sanitizeReturnTo(url.searchParams.get('from'));

	// Build the eBay `state` parameter. Two parallel mechanisms protect this
	// flow because iOS Safari ITP strips cookies on cross-site redirects:
	//   1. HMAC-signed state token via OAUTH_STATE_SECRET — survives cookie loss,
	//      carries returnTo + CSRF nonce. Falls back to a random hex string when
	//      the env var is missing so the existing cookie path still works.
	//   2. ebay_oauth_state cookie — backup CSRF + holds the user ID, since the
	//      Supabase session cookie often doesn't survive the cross-domain trip.
	const signed = signState(returnTo);
	const state = signed ?? crypto.randomBytes(32).toString('hex');

	const cookiePayload = JSON.stringify({ state, userId: user.id, returnTo });
	cookies.set('ebay_oauth_state', cookiePayload, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 600
	});

	throw redirect(302, buildAuthUrl(state));
};
