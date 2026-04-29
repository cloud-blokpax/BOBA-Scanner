/**
 * WTP credential storage. Reads/writes the wtp_seller_credentials table
 * via the service-role client. All callers must be server-side and have
 * already authenticated the user.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptCredential, decryptCredential } from './crypto';

export interface WtpCredentials {
	api_token: string;
	refresh_token?: string | null;
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
