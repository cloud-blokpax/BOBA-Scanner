/**
 * WTP connect flow (Option B: Supabase auth bridge).
 *
 * User provides their WTP email + password ONCE. We sign in via WTP's
 * /auth/v1/token endpoint, store the rotating refresh_token (NOT the
 * password), and use it to mint short-lived access tokens for posting.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { saveCredentials, type WtpCredentials } from './credentials';
import {
	signInWithPassword,
	fetchStripeConnectStatus,
	isWtpConfigured,
	WtpAuthError
} from './wtp-client';

export { isWtpConfigured };

export interface VerifyResult {
	ok: boolean;
	wtp_username?: string;
	stripe_connect_status?: string;
	error?: string;
}

export async function verifyAndStoreCredentials(
	admin: SupabaseClient,
	userId: string,
	email: string,
	password: string
): Promise<VerifyResult> {
	if (!email || !password) {
		return { ok: false, error: 'Email and password are required' };
	}

	let session;
	try {
		session = await signInWithPassword(email, password);
	} catch (e) {
		if (e instanceof WtpAuthError) {
			return {
				ok: false,
				error: e.httpStatus === 400 ? 'Invalid email or password' : e.message
			};
		}
		return { ok: false, error: e instanceof Error ? e.message : 'Network error contacting WTP' };
	}

	const stripe = await fetchStripeConnectStatus(session);

	const credentials: WtpCredentials = {
		refresh_token: session.refresh_token,
		wtp_user_id: session.wtp_user_id,
		email: session.email ?? email
	};

	await saveCredentials(admin, userId, credentials, {
		wtp_username: session.email ?? email,
		stripe_connect_status: stripe.status === 'unknown' ? null : stripe.status,
		scopes: null
	});

	return {
		ok: true,
		wtp_username: session.email ?? email,
		stripe_connect_status: stripe.status === 'unknown' ? undefined : stripe.status
	};
}
