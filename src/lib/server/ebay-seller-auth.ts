/**
 * eBay Seller OAuth — Authorization Code Grant
 *
 * Handles per-user seller authorization for the Inventory API.
 * Separate from ebay-auth.ts which handles app-level Browse API tokens.
 */

import { env } from '$env/dynamic/private';
import { createClient } from '@supabase/supabase-js';

const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

// Full scope set granted by eBay for this application.
const SELLER_SCOPES = [
	'https://api.ebay.com/oauth/api_scope',
	'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
	'https://api.ebay.com/oauth/api_scope/sell.inventory',
	'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
	'https://api.ebay.com/oauth/api_scope/sell.account',
	'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
	'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
	'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
	'https://api.ebay.com/oauth/api_scope/sell.marketing',
	'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
	'https://api.ebay.com/oauth/api_scope/sell.finances',
	'https://api.ebay.com/oauth/api_scope/sell.payment.dispute',
	'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
	'https://api.ebay.com/oauth/api_scope/sell.reputation',
	'https://api.ebay.com/oauth/api_scope/sell.reputation.readonly',
	'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription',
	'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly',
	'https://api.ebay.com/oauth/api_scope/sell.stores',
	'https://api.ebay.com/oauth/api_scope/sell.stores.readonly',
	'https://api.ebay.com/oauth/scope/sell.edelivery',
	'https://api.ebay.com/oauth/api_scope/commerce.vero',
	'https://api.ebay.com/oauth/api_scope/sell.inventory.mapping',
	'https://api.ebay.com/oauth/api_scope/commerce.message',
	'https://api.ebay.com/oauth/api_scope/commerce.feedback',
	'https://api.ebay.com/oauth/api_scope/commerce'
].join(' ');

function getServiceClient() {
	const url = env.PUBLIC_SUPABASE_URL ?? '';
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
	if (!url || !serviceKey) return null;
	return createClient(url, serviceKey);
}

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
	if (error || !tokenRow) return null;

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
		if (response.status === 400 || response.status === 401) await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
		return null;
	}

	const data = await response.json();
	await adminClient.from('ebay_seller_tokens').update({
		access_token: data.access_token,
		access_token_expires_at: new Date(Date.now() + (data.expires_in || 7200) * 1000).toISOString(),
		updated_at: new Date().toISOString()
	}).eq('user_id', userId);

	return data.access_token;
}

export async function isSellerConnected(userId: string): Promise<boolean> {
	const adminClient = getServiceClient();
	if (!adminClient) return false;
	const { data } = await adminClient.from('ebay_seller_tokens').select('refresh_token_expires_at').eq('user_id', userId).maybeSingle();
	if (!data) return false;
	return new Date(data.refresh_token_expires_at).getTime() > Date.now();
}

export async function disconnectSeller(userId: string): Promise<void> {
	const adminClient = getServiceClient();
	if (!adminClient) return;
	await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
}
