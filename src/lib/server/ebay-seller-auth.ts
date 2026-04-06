/**
 * eBay Seller OAuth — Authorization Code Grant
 *
 * Handles per-user seller authorization for the Inventory API.
 * Separate from ebay-auth.ts which handles app-level Browse API tokens.
 */

import { env } from '$env/dynamic/private';
import { getAdminClient } from '$lib/server/supabase-admin';

const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

// Minimal scopes — only request what the app actually uses (inventory + account policy reads).
// Over-provisioning scopes risks seller account compromise if tokens are leaked.
const SELLER_SCOPES = [
	'https://api.ebay.com/oauth/api_scope',
	'https://api.ebay.com/oauth/api_scope/sell.inventory',
	'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
	'https://api.ebay.com/oauth/api_scope/sell.account.readonly'
].join(' ');

// Use shared admin client for service-role operations
const getServiceClient = getAdminClient;

function getBasicAuth(): string {
	return Buffer.from(`${env.EBAY_CLIENT_ID ?? ''}:${env.EBAY_CLIENT_SECRET ?? ''}`).toString('base64');
}

export function isSellerOAuthConfigured(): boolean {
	return !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET && env.EBAY_RUNAME);
}

export function buildAuthUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: env.EBAY_CLIENT_ID ?? '',
		redirect_uri: env.EBAY_RUNAME ?? '',
		response_type: 'code',
		scope: SELLER_SCOPES,
		state
	});
	return `${EBAY_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string, userId: string): Promise<string | null> {
	const response = await fetch(EBAY_TOKEN_URL, {
		method: 'POST',
		headers: { Authorization: `Basic ${getBasicAuth()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: env.EBAY_RUNAME ?? ''
		}).toString()
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => '');
		console.error(`[ebay-seller-auth] Token exchange failed: ${response.status}`, errorText);
		throw new Error(`eBay token exchange failed: ${response.status}`);
	}

	const data = await response.json();
	if (!data.access_token || !data.refresh_token) {
		console.error('[ebay-seller-auth] Token response missing required fields:', Object.keys(data));
		throw new Error('eBay token response missing access_token or refresh_token');
	}
	const now = new Date();
	const accessExpires = new Date(now.getTime() + (data.expires_in || 7200) * 1000);
	const refreshExpires = new Date(now.getTime() + (data.refresh_token_expires_in || 47304000) * 1000);

	const adminClient = getServiceClient();
	if (!adminClient) throw new Error('Service role client not configured');

	const { error: upsertError } = await adminClient.from('ebay_seller_tokens').upsert({
		user_id: userId,
		access_token: data.access_token,
		access_token_expires_at: accessExpires.toISOString(),
		refresh_token: data.refresh_token,
		refresh_token_expires_at: refreshExpires.toISOString(),
		scopes: SELLER_SCOPES,
		updated_at: new Date().toISOString()
	}, { onConflict: 'user_id' });

	if (upsertError) {
		console.error('[ebay-seller-auth] Token storage failed:', upsertError);
		throw new Error('Failed to store eBay tokens');
	}
	return userId;
}

export async function getSellerToken(userId: string): Promise<string | null> {
	const adminClient = getServiceClient();
	if (!adminClient) return null;

	const { data: tokenRow, error } = await adminClient.from('ebay_seller_tokens').select('*').eq('user_id', userId).maybeSingle();
	if (error) {
		console.error('[ebay-seller-auth] Token lookup failed:', error.message);
		return null;
	}
	if (!tokenRow) return null;

	// Check if access token is still valid (5-minute buffer)
	if (Date.now() < new Date(tokenRow.access_token_expires_at).getTime() - 300_000) return tokenRow.access_token;

	// Check if refresh token is expired
	if (Date.now() >= new Date(tokenRow.refresh_token_expires_at).getTime()) {
		await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
		return null;
	}

	// Refresh the access token
	const response = await fetch(EBAY_TOKEN_URL, {
		method: 'POST',
		headers: { Authorization: `Basic ${getBasicAuth()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokenRow.refresh_token, scope: SELLER_SCOPES }).toString()
	});

	if (!response.ok) {
		const errorBody = await response.text().catch(() => '');
		console.error(`[ebay-seller-auth] Token refresh failed (${response.status}):`, errorBody);
		if (response.status === 400 || response.status === 401) await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
		return null;
	}

	const data = await response.json();
	if (!data.access_token) {
		console.error('[ebay-seller-auth] Refresh response missing access_token');
		return null;
	}
	const { error: tokenError } = await adminClient.from('ebay_seller_tokens').update({
		access_token: data.access_token,
		access_token_expires_at: new Date(Date.now() + Math.max(data.expires_in ?? 7200, 60) * 1000).toISOString(),
		updated_at: new Date().toISOString()
	}).eq('user_id', userId);
	if (tokenError) {
		console.error('[ebay-seller-auth] Token update FAILED:', tokenError.message);
	}

	return data.access_token;
}

export async function isSellerConnected(userId: string): Promise<boolean> {
	const adminClient = getServiceClient();
	if (!adminClient) return false;
	const { data } = await adminClient.from('ebay_seller_tokens').select('refresh_token_expires_at').eq('user_id', userId).maybeSingle();
	if (!data) return false;
	return new Date(data.refresh_token_expires_at).getTime() > Date.now();
}

export interface SellerValidationResult {
	valid: boolean;
	username?: string;
	sellingLimit?: { amount: number; quantity: number };
	error?: string;
}

/**
 * Validates the eBay seller connection by making a lightweight API call.
 * Uses the Sell Account API's /privilege endpoint to verify the token works
 * and retrieve basic seller info. This catches cases where the user revoked
 * access on eBay's side or the token was otherwise invalidated.
 */
export async function validateSellerConnection(userId: string): Promise<SellerValidationResult> {
	const token = await getSellerToken(userId);
	if (!token) return { valid: false, error: 'No valid token — please reconnect your eBay account' };

	try {
		const res = await fetch('https://api.ebay.com/sell/account/v1/privilege', {
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
		});

		if (res.status === 401 || res.status === 403) {
			// Token rejected by eBay — clean up stale row
			const adminClient = getServiceClient();
			if (adminClient) await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
			return { valid: false, error: 'eBay rejected the token — please reconnect your account' };
		}

		if (!res.ok) {
			const body = await res.text().catch(() => '');
			console.error(`[ebay-seller-auth] Privilege check failed (${res.status}):`, body);
			return { valid: false, error: `eBay API error (${res.status})` };
		}

		const data = await res.json();
		return {
			valid: true,
			sellingLimit: data.sellingLimit ? {
				amount: data.sellingLimit.amount?.value ?? 0,
				quantity: data.sellingLimit.quantity ?? 0
			} : undefined
		};
	} catch (err) {
		console.error('[ebay-seller-auth] Privilege check network error:', err);
		return { valid: false, error: 'Could not reach eBay — try again later' };
	}
}

export async function disconnectSeller(userId: string): Promise<void> {
	const adminClient = getServiceClient();
	if (!adminClient) return;
	await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
}
