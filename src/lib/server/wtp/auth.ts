/**
 * WTP OAuth-style connect flow.
 *
 * v1: API-token paste flow. The user generates a personal access token
 * inside their WTP dashboard, pastes it into /settings/wtp-connect,
 * and we encrypt + store it via credentials.saveCredentials.
 *
 * Once WTP exposes a real OAuth flow, swap this module for an
 * authorization-code-grant implementation that mirrors
 * src/lib/server/ebay-seller-auth.ts.
 */

import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveCredentials, type WtpCredentials } from './credentials';

const WTP_API_BASE = env.WTP_API_BASE_URL ?? 'https://api.wonderstradingpost.com';

export function isWtpConfigured(): boolean {
	return !!env.WTP_API_BASE_URL && !!env.WTP_CREDENTIAL_KEY;
}

export interface VerifyResult {
	ok: boolean;
	wtp_username?: string;
	stripe_connect_status?: string;
	scopes?: string;
	error?: string;
}

/**
 * Calls WTP to verify an API token, then stores it. Treat the WTP /me
 * endpoint shape as opaque — we extract username + Stripe status if
 * present, otherwise persist with nulls and let /api/wtp/sync update.
 */
export async function verifyAndStoreToken(
	admin: SupabaseClient,
	userId: string,
	token: string
): Promise<VerifyResult> {
	if (!token || token.length < 8) {
		return { ok: false, error: 'Token looks invalid (too short)' };
	}

	let username: string | undefined;
	let stripeStatus: string | undefined;
	let scopes: string | undefined;

	try {
		const response = await fetch(`${WTP_API_BASE}/v1/me`, {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
		});
		if (!response.ok) {
			const body = await response.text().catch(() => '');
			return { ok: false, error: `WTP rejected token (${response.status}): ${body.slice(0, 200)}` };
		}
		const data = (await response.json()) as Record<string, unknown>;
		username = typeof data.username === 'string' ? data.username : undefined;
		stripeStatus = typeof data.stripe_connect_status === 'string' ? data.stripe_connect_status : undefined;
		scopes = Array.isArray(data.scopes) ? (data.scopes as string[]).join(' ') : undefined;
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : 'Network error contacting WTP' };
	}

	const credentials: WtpCredentials = { api_token: token };
	await saveCredentials(admin, userId, credentials, {
		wtp_username: username ?? null,
		stripe_connect_status: stripeStatus ?? null,
		scopes: scopes ?? null
	});

	return {
		ok: true,
		wtp_username: username,
		stripe_connect_status: stripeStatus,
		scopes
	};
}

export function getWtpApiBase(): string {
	return WTP_API_BASE;
}
