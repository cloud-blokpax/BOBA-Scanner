import { redirect } from '@sveltejs/kit';
import { exchangeCode } from '$lib/server/ebay-seller-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	// ── Handle eBay errors ────────────────────────────
	const ebayError = url.searchParams.get('error');
	if (ebayError) throw redirect(303, '/settings?ebay=declined');

	// ── Validate CSRF state and extract user ID ──────
	// The Supabase session cookie often doesn't survive the cross-site
	// redirect from eBay (iOS Safari ITP). So we stored the user ID
	// in the ebay_oauth_state cookie before the redirect.
	const rawCookie = cookies.get('ebay_oauth_state');
	cookies.delete('ebay_oauth_state', { path: '/' });

	if (!rawCookie) {
		console.error('[ebay-callback] No state cookie — session lost during eBay redirect');
		throw redirect(303, '/settings?ebay=error&reason=state_missing');
	}

	let storedState: string;
	let userId: string;

	try {
		const parsed = JSON.parse(rawCookie);
		storedState = parsed.state;
		userId = parsed.userId;
	} catch (err) {
		// Backwards compatibility: old cookie format was just the state string
		console.warn('[ebay-callback] Cookie JSON parse failed, falling back to legacy format:', err instanceof Error ? err.message : err);
		storedState = rawCookie;
		userId = locals.user?.id ?? '';
	}

	if (!userId) {
		console.error('[ebay-callback] No user ID in state cookie and no session');
		throw redirect(303, '/settings?ebay=error&reason=session_expired');
	}

	const returnedState = url.searchParams.get('state');
	if (!returnedState || returnedState !== storedState) {
		console.error('[ebay-callback] State mismatch — possible CSRF or cookie expiry');
		throw redirect(303, '/settings?ebay=error&reason=state_mismatch');
	}

	// ── Exchange authorization code for tokens ───────
	const code = url.searchParams.get('code');
	if (!code) throw redirect(303, '/settings?ebay=error&reason=no_code');

	try {
		await exchangeCode(code, userId);
		throw redirect(303, '/settings?ebay=connected');
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status >= 300 && (err as { status: number }).status < 400) throw err;
		console.error('[ebay-callback] Token exchange failed:', err);
		throw redirect(303, '/settings?ebay=error&reason=token_exchange');
	}
};
