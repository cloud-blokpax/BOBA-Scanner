import { redirect } from '@sveltejs/kit';
import { exchangeCode, getSellerToken } from '$lib/server/ebay-seller-auth';
import { optInToBusinessPolicies } from '$lib/server/ebay-policies';
import { verifyState, sanitizeReturnTo } from '$lib/server/auth/oauth-state';
import type { RequestHandler } from './$types';

/**
 * Append `ebay=connected` to the returnTo path so the destination page can
 * surface a success toast without losing existing query params.
 */
function withConnectedFlag(path: string): string {
	const safe = sanitizeReturnTo(path);
	return safe + (safe.includes('?') ? '&' : '?') + 'ebay=connected';
}

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

	const returnedState = url.searchParams.get('state');

	// ── Resolve returnTo from HMAC state (preferred) or cookie fallback ──
	const verifiedState = verifyState(returnedState);
	let returnTo = verifiedState?.returnTo ?? '/settings';

	if (!rawCookie) {
		// No cookie. If state is HMAC-verified, we can still trust returnTo,
		// but we have no userId — session must have survived for this to work.
		if (!verifiedState) {
			console.error('[ebay-callback] No state cookie and no verifiable state token');
			throw redirect(303, '/settings?ebay=error&reason=state_missing');
		}
	}

	let storedState: string | null = null;
	let userId: string | null = null;
	let cookieReturnTo: string | null = null;

	if (rawCookie) {
		try {
			const parsed = JSON.parse(rawCookie);
			storedState = parsed.state ?? null;
			userId = parsed.userId ?? null;
			cookieReturnTo = typeof parsed.returnTo === 'string' ? parsed.returnTo : null;
		} catch (err) {
			// Backwards compatibility: old cookie format was just the state string
			console.warn('[ebay-callback] Cookie JSON parse failed, falling back to legacy format:', err instanceof Error ? err.message : err);
			storedState = rawCookie;
			userId = locals.user?.id ?? null;
		}
	}

	// Prefer HMAC-verified returnTo. Fall back to cookie's returnTo if the HMAC
	// path didn't yield one (e.g. OAUTH_STATE_SECRET unset, legacy cookie).
	if (!verifiedState && cookieReturnTo) {
		returnTo = sanitizeReturnTo(cookieReturnTo);
	}

	// Fall back to the session user if cookie lacked one and state was missing too.
	if (!userId) userId = locals.user?.id ?? null;

	if (!userId) {
		console.error('[ebay-callback] No user ID in state cookie and no session');
		throw redirect(303, '/settings?ebay=error&reason=session_expired');
	}

	// CSRF check: when we have a cookie state, it must match the returned state.
	// When state is HMAC-verified we already trust it (HMAC IS the CSRF check),
	// so a missing/legacy cookie is acceptable.
	if (storedState && (!returnedState || returnedState !== storedState) && !verifiedState) {
		console.error('[ebay-callback] State mismatch — possible CSRF or cookie expiry');
		throw redirect(303, '/settings?ebay=error&reason=state_mismatch');
	}

	// ── Exchange authorization code for tokens ───────
	const code = url.searchParams.get('code');
	if (!code) throw redirect(303, '/settings?ebay=error&reason=no_code');

	try {
		await exchangeCode(code, userId);

		// Auto-enroll in Business Policies so listing flow works immediately.
		// Non-blocking — if this fails, the defensive retry in getSellerPolicies handles it.
		try {
			const token = await getSellerToken(userId);
			if (token) {
				await optInToBusinessPolicies(token);
			}
		} catch (optInErr) {
			console.warn('[ebay-callback] Business Policy opt-in failed (non-blocking):', optInErr instanceof Error ? optInErr.message : optInErr);
		}

		throw redirect(303, withConnectedFlag(returnTo));
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status >= 300 && (err as { status: number }).status < 400) throw err;
		console.error('[ebay-callback] Token exchange failed:', err);
		throw redirect(303, '/settings?ebay=error&reason=token_exchange');
	}
};
