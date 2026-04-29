/**
 * WTP credential storage. Reads/writes the wtp_seller_credentials table
 * via the service-role client. All callers must be server-side and have
 * already authenticated the user.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptCredential, decryptCredential } from './crypto';
import { refreshSession, WtpAuthError, type WtpSession } from './wtp-client';

export interface WtpCredentials {
	refresh_token: string;
	wtp_user_id: string;
	email?: string | null;
	// Legacy field — old token-paste records still have api_token. Tolerated on
	// read so existing connections aren't blown up; never written by Option B.
	api_token?: string;
	[key: string]: unknown;
}

export interface WtpCredentialRecord {
	user_id: string;
	credentials: WtpCredentials;
	wtp_username: string | null;
	stripe_connect_status: string | null;
	stripe_connect_checked_at: string | null;
	scopes: string | null;
	connected_at: string;
	updated_at: string;
}

export async function saveCredentials(
	admin: SupabaseClient,
	userId: string,
	credentials: WtpCredentials,
	meta: {
		wtp_username?: string | null;
		stripe_connect_status?: string | null;
		scopes?: string | null;
	} = {}
): Promise<void> {
	const blob = await encryptCredential(JSON.stringify(credentials));
	const { error } = await admin.from('wtp_seller_credentials').upsert({
		user_id: userId,
		credential_ciphertext: blob.ciphertext,
		credential_iv: blob.iv,
		wtp_username: meta.wtp_username ?? null,
		stripe_connect_status: meta.stripe_connect_status ?? null,
		stripe_connect_checked_at: meta.stripe_connect_status ? new Date().toISOString() : null,
		scopes: meta.scopes ?? null,
		updated_at: new Date().toISOString()
	});
	if (error) throw error;
}

export async function getCredentials(
	admin: SupabaseClient,
	userId: string
): Promise<WtpCredentialRecord | null> {
	const { data, error } = await admin
		.from('wtp_seller_credentials')
		.select('*')
		.eq('user_id', userId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;

	const plaintext = await decryptCredential({
		ciphertext: data.credential_ciphertext,
		iv: data.credential_iv
	});
	return {
		user_id: data.user_id,
		credentials: JSON.parse(plaintext) as WtpCredentials,
		wtp_username: data.wtp_username,
		stripe_connect_status: data.stripe_connect_status,
		stripe_connect_checked_at: data.stripe_connect_checked_at,
		scopes: data.scopes,
		connected_at: data.connected_at,
		updated_at: data.updated_at
	};
}

export async function disconnect(admin: SupabaseClient, userId: string): Promise<void> {
	const { error } = await admin
		.from('wtp_seller_credentials')
		.delete()
		.eq('user_id', userId);
	if (error) throw error;
}

export async function updateStripeConnectStatus(
	admin: SupabaseClient,
	userId: string,
	status: string
): Promise<void> {
	const { error } = await admin
		.from('wtp_seller_credentials')
		.update({
			stripe_connect_status: status,
			stripe_connect_checked_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		})
		.eq('user_id', userId);
	if (error) throw error;
}

/**
 * Persist a rotated session (new refresh_token) without touching the metadata
 * columns. Used by getActiveSession after a refresh — we just need the new
 * ciphertext + IV + updated_at. Stripe status, username, etc. stay as-is.
 */
async function persistRotatedSession(
	admin: SupabaseClient,
	userId: string,
	credentials: WtpCredentials
): Promise<void> {
	const blob = await encryptCredential(JSON.stringify(credentials));
	const { error } = await admin
		.from('wtp_seller_credentials')
		.update({
			credential_ciphertext: blob.ciphertext,
			credential_iv: blob.iv,
			updated_at: new Date().toISOString()
		})
		.eq('user_id', userId);
	if (error) throw error;
}

/**
 * Get a usable WTP session for this user. Tries refresh-token first; throws
 * a clear error if the refresh fails (user must reconnect).
 *
 * On every successful refresh, the rotating refresh_token is persisted.
 */
export async function getActiveSession(
	admin: SupabaseClient,
	userId: string
): Promise<WtpSession> {
	const record = await getCredentials(admin, userId);
	if (!record) throw new Error('User is not connected to WTP');

	const { refresh_token, wtp_user_id, email } = record.credentials;
	if (!refresh_token) {
		throw new Error('WTP credentials are missing refresh_token — please reconnect');
	}

	let session: WtpSession;
	try {
		session = await refreshSession(refresh_token);
	} catch (e) {
		if (e instanceof WtpAuthError && (e.httpStatus === 400 || e.httpStatus === 401)) {
			throw new Error('WTP session expired — please reconnect under Settings → WTP');
		}
		throw e;
	}

	const updated: WtpCredentials = {
		refresh_token: session.refresh_token,
		wtp_user_id: session.wtp_user_id || wtp_user_id,
		email: session.email ?? email ?? null
	};
	await persistRotatedSession(admin, userId, updated);

	return session;
}
