/**
 * WTP connection-status helpers used by /api/wtp/status.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isWtpConfigured, fetchStripeConnectStatus } from './wtp-client';
import { isCryptoConfigured } from './crypto';
import { getActiveSession, getCredentials, updateStripeConnectStatus } from './credentials';

export interface WtpStatus {
	configured: boolean;
	connected: boolean;
	wtp_username: string | null;
	stripe_connect_status: string | null;
	stripe_connect_checked_at: string | null;
	connected_at: string | null;
}

export async function getStatus(admin: SupabaseClient, userId: string): Promise<WtpStatus> {
	const configured = isWtpConfigured() && isCryptoConfigured();
	if (!configured) {
		return {
			configured: false,
			connected: false,
			wtp_username: null,
			stripe_connect_status: null,
			stripe_connect_checked_at: null,
			connected_at: null
		};
	}

	const creds = await getCredentials(admin, userId);
	if (!creds) {
		return {
			configured: true,
			connected: false,
			wtp_username: null,
			stripe_connect_status: null,
			stripe_connect_checked_at: null,
			connected_at: null
		};
	}

	return {
		configured: true,
		connected: true,
		wtp_username: creds.wtp_username,
		stripe_connect_status: creds.stripe_connect_status,
		stripe_connect_checked_at: creds.stripe_connect_checked_at,
		connected_at: creds.connected_at
	};
}

/**
 * Re-fetches the Stripe Connect status from WTP and writes it back
 * to wtp_seller_credentials. Used by /api/wtp/sync and surfaced in
 * the sell flow banner.
 */
export async function refreshStripeStatus(
	admin: SupabaseClient,
	userId: string
): Promise<string | null> {
	const creds = await getCredentials(admin, userId);
	if (!creds) return null;

	let session;
	try {
		session = await getActiveSession(admin, userId);
	} catch {
		return creds.stripe_connect_status;
	}

	const result = await fetchStripeConnectStatus(session);
	if (result.status === 'unknown') return creds.stripe_connect_status;

	if (result.status !== creds.stripe_connect_status) {
		await updateStripeConnectStatus(admin, userId, result.status);
	}
	return result.status;
}
