/**
 * WTP Supabase API client (Option B: auth bridge through their public Supabase).
 *
 * WTP's backend is a Supabase project. We authenticate as the user via their
 * Supabase auth endpoints, then make REST + storage calls scoped to the user's
 * session.
 *
 * No third-party SDK needed — fetch + JSON. Keeps the bundle small and lets us
 * swap to a future WTP-native API by replacing this file alone.
 */

import { env } from '$env/dynamic/private';

const UA = 'CardScanner/1.0 (boba.cards; sell-flow; contact: jamespoto@gmail.com)';

export function isWtpConfigured(): boolean {
	return !!env.WTP_SUPABASE_URL && !!env.WTP_SUPABASE_ANON_KEY && !!env.WTP_CREDENTIAL_KEY;
}

export function getWtpUrl(): string {
	const u = env.WTP_SUPABASE_URL;
	if (!u) throw new Error('WTP_SUPABASE_URL is not configured');
	return u.replace(/\/$/, '');
}

function getWtpAnon(): string {
	const k = env.WTP_SUPABASE_ANON_KEY;
	if (!k) throw new Error('WTP_SUPABASE_ANON_KEY is not configured');
	return k;
}

export class WtpAuthError extends Error {
	constructor(
		message: string,
		public code: string,
		public httpStatus: number
	) {
		super(message);
	}
}

export interface WtpSession {
	access_token: string;
	refresh_token: string;
	expires_at: number; // unix seconds
	wtp_user_id: string;
	email: string | null;
}

interface SupabaseTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	expires_at?: number;
	user?: { id: string; email?: string };
	error?: string;
	error_description?: string;
	error_code?: string;
	msg?: string;
	code?: number;
}

async function postAuth(
	grantType: 'password' | 'refresh_token',
	body: unknown
): Promise<WtpSession> {
	const r = await fetch(`${getWtpUrl()}/auth/v1/token?grant_type=${grantType}`, {
		method: 'POST',
		headers: {
			apikey: getWtpAnon(),
			'Content-Type': 'application/json',
			'User-Agent': UA
		},
		body: JSON.stringify(body)
	});
	const data = (await r.json().catch(() => ({}))) as SupabaseTokenResponse;
	if (!r.ok) {
		throw new WtpAuthError(
			data.msg || data.error_description || data.error || 'WTP auth failed',
			data.error_code || data.error || 'unknown',
			r.status
		);
	}
	if (!data.access_token || !data.refresh_token || !data.user?.id) {
		throw new WtpAuthError('WTP auth response missing fields', 'malformed_response', 500);
	}
	return {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
		wtp_user_id: data.user.id,
		email: data.user.email ?? null
	};
}

export function signInWithPassword(email: string, password: string): Promise<WtpSession> {
	return postAuth('password', { email, password });
}

export function refreshSession(refreshToken: string): Promise<WtpSession> {
	return postAuth('refresh_token', { refresh_token: refreshToken });
}

/**
 * Authenticated fetch helper — automatically applies apikey + access_token
 * headers. Path is appended to the WTP URL.
 */
export async function wtpFetch(
	session: WtpSession,
	path: string,
	init: RequestInit = {}
): Promise<Response> {
	return fetch(`${getWtpUrl()}${path}`, {
		...init,
		headers: {
			apikey: getWtpAnon(),
			Authorization: `Bearer ${session.access_token}`,
			'User-Agent': UA,
			...(init.headers ?? {})
		}
	});
}

/**
 * Stripe Connect status (best-effort — returns 'unknown' on any failure).
 */
export async function fetchStripeConnectStatus(session: WtpSession): Promise<{
	status: 'not_started' | 'pending' | 'active' | 'restricted' | 'rejected' | 'unknown';
}> {
	try {
		const r = await wtpFetch(session, '/functions/v1/connect-status', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}'
		});
		if (!r.ok) return { status: 'unknown' };
		const data = (await r.json()) as {
			payouts_enabled?: boolean;
			charges_enabled?: boolean;
			details_submitted?: boolean;
		};
		if (data.payouts_enabled && data.charges_enabled) return { status: 'active' };
		if (data.details_submitted) return { status: 'pending' };
		if (data.details_submitted === false) return { status: 'not_started' };
		return { status: 'unknown' };
	} catch {
		return { status: 'unknown' };
	}
}
