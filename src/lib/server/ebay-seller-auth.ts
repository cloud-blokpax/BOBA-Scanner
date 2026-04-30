/**
 * eBay Seller OAuth — Authorization Code Grant
 *
 * Handles per-user seller authorization for the Inventory API.
 * Separate from ebay-auth.ts which handles app-level Browse API tokens.
 */

import { env } from '$env/dynamic/private';
import { getAdminClient } from '$lib/server/supabase-admin';
import { logEvent } from '$lib/server/diagnostics';
import { encryptToken, decryptToken, isTokenCryptoConfigured } from '$lib/server/auth/token-crypto';
import { getRedis } from '$lib/server/redis';

const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

// Minimal scopes — only request what the app actually uses.
// sell.inventory + sell.account for listing creation.
// sell.fulfillment.readonly for tracking sold items / orders.
const SELLER_SCOPES = [
	'https://api.ebay.com/oauth/api_scope',
	'https://api.ebay.com/oauth/api_scope/sell.inventory',
	'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
	'https://api.ebay.com/oauth/api_scope/sell.account',
	'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
	'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly'
].join(' ');

// Use shared admin client for service-role operations
const getServiceClient = getAdminClient;

function getBasicAuth(): string {
	return Buffer.from(`${env.EBAY_CLIENT_ID ?? ''}:${env.EBAY_CLIENT_SECRET ?? ''}`).toString('base64');
}

export function isSellerOAuthConfigured(): boolean {
	return !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET && env.EBAY_RUNAME);
}

/**
 * Encrypt a token for at-rest storage. Falls back to plaintext when no
 * EBAY_TOKEN_ENCRYPTION_KEY is configured (dev environments). Production
 * is expected to set the key — the privacy page promises encryption.
 */
function maybeEncryptForStore(plaintext: string): string {
	const ct = encryptToken(plaintext);
	return ct ?? plaintext;
}

/**
 * Decrypt a stored token. Returns plaintext for legacy unencrypted rows
 * (rows written before the key was deployed) so the rollout doesn't have
 * to re-encrypt every existing connection in one shot — the next refresh
 * upgrades the row to ciphertext.
 */
function decryptStored(stored: string | null | undefined): string | null {
	return decryptToken(stored);
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
		access_token: maybeEncryptForStore(data.access_token),
		access_token_expires_at: accessExpires.toISOString(),
		refresh_token: maybeEncryptForStore(data.refresh_token),
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

/**
 * Try to acquire a single-flight Redis lock for a refresh. eBay rotates
 * refresh tokens on each use, so two parallel refreshes can race and one
 * will end up holding an invalidated token. The lock funnels concurrent
 * callers through a single refresh; losers re-read the stored row.
 *
 * Returns true if THIS caller acquired the lock and should perform the
 * refresh. Best-effort: if Redis is unavailable, the function returns
 * true (no lock available, fall back to inline refresh).
 */
async function acquireRefreshLock(userId: string, ttlSeconds = 30): Promise<boolean> {
	const r = getRedis();
	if (!r) return true;
	try {
		const res = await r.set(`ebay-refresh:${userId}`, '1', { nx: true, ex: ttlSeconds });
		return res === 'OK';
	} catch (err) {
		console.debug('[ebay-seller-auth] Refresh lock acquire failed (allowing inline):', err);
		return true;
	}
}

async function releaseRefreshLock(userId: string): Promise<void> {
	const r = getRedis();
	if (!r) return;
	try {
		await r.del(`ebay-refresh:${userId}`);
	} catch (err) {
		console.debug('[ebay-seller-auth] Refresh lock release failed:', err);
	}
}

const REFRESH_WAIT_INTERVAL_MS = 200;
const REFRESH_WAIT_MAX_MS = 5000;

async function waitAndReread(
	adminClient: NonNullable<ReturnType<typeof getServiceClient>>,
	userId: string
): Promise<string | null> {
	const deadline = Date.now() + REFRESH_WAIT_MAX_MS;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, REFRESH_WAIT_INTERVAL_MS));
		const { data: row } = await adminClient
			.from('ebay_seller_tokens')
			.select('access_token, access_token_expires_at')
			.eq('user_id', userId)
			.maybeSingle();
		if (
			row &&
			Date.now() < new Date(row.access_token_expires_at).getTime() - 60_000
		) {
			return decryptStored(row.access_token);
		}
	}
	return null;
}

export async function getSellerToken(userId: string): Promise<string | null> {
	const adminClient = getServiceClient();
	if (!adminClient) return null;

	const { data: tokenRow, error } = await adminClient
		.from('ebay_seller_tokens')
		.select('*')
		.eq('user_id', userId)
		.maybeSingle();
	if (error) {
		console.error('[ebay-seller-auth] Token lookup failed:', error.message);
		return null;
	}
	if (!tokenRow) return null;

	// Check if access token is still valid (5-minute buffer)
	if (Date.now() < new Date(tokenRow.access_token_expires_at).getTime() - 300_000) {
		return decryptStored(tokenRow.access_token);
	}

	// Refresh-token expired? Wipe the row.
	if (Date.now() >= new Date(tokenRow.refresh_token_expires_at).getTime()) {
		await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
		return null;
	}

	// Single-flight: only one caller per user performs a refresh at a time.
	// Losers wait for the winner to write the new access token and then read it.
	const acquired = await acquireRefreshLock(userId);
	if (!acquired) {
		const fresh = await waitAndReread(adminClient, userId);
		if (fresh) return fresh;
		// Fall through: lock-holder didn't finish in time, try a refresh anyway.
	}

	try {
		const refreshPlaintext = decryptStored(tokenRow.refresh_token);
		if (!refreshPlaintext) {
			console.error('[ebay-seller-auth] Refresh token decrypt failed');
			return null;
		}

		const response = await fetch(EBAY_TOKEN_URL, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${getBasicAuth()}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshPlaintext,
				scope: SELLER_SCOPES
			}).toString()
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => '');
			console.error(`[ebay-seller-auth] Token refresh failed (${response.status}):`, errorBody);
			if (response.status === 400 || response.status === 401) {
				await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
			}
			return null;
		}

		const data = await response.json();
		if (!data.access_token) {
			console.error('[ebay-seller-auth] Refresh response missing access_token');
			return null;
		}

		const update: Record<string, unknown> = {
			access_token: maybeEncryptForStore(data.access_token),
			access_token_expires_at: new Date(
				Date.now() + Math.max(data.expires_in ?? 7200, 60) * 1000
			).toISOString(),
			updated_at: new Date().toISOString()
		};
		// eBay sometimes rotates the refresh token too. Persist the rotation.
		if (typeof data.refresh_token === 'string' && data.refresh_token.length > 0) {
			update.refresh_token = maybeEncryptForStore(data.refresh_token);
			if (typeof data.refresh_token_expires_in === 'number') {
				update.refresh_token_expires_at = new Date(
					Date.now() + data.refresh_token_expires_in * 1000
				).toISOString();
			}
		}
		// Migrate legacy plaintext rows opportunistically.
		if (
			isTokenCryptoConfigured() &&
			typeof tokenRow.refresh_token === 'string' &&
			!tokenRow.refresh_token.startsWith('gcm1:')
		) {
			update.refresh_token = maybeEncryptForStore(refreshPlaintext);
		}

		const { error: tokenError } = await adminClient
			.from('ebay_seller_tokens')
			.update(update)
			.eq('user_id', userId);
		if (tokenError) {
			console.error('[ebay-seller-auth] Token update FAILED:', tokenError.message);
		}

		return data.access_token as string;
	} finally {
		if (acquired) await releaseRefreshLock(userId);
	}
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
		void logEvent({ level: 'error', event: 'ebay.seller_auth.privilege_check_network_error', error: err });
		return { valid: false, error: 'Could not reach eBay — try again later' };
	}
}

export interface SellerProfile {
	username: string | null;
	email: string | null;
}

/**
 * Fetches the eBay seller's username and email via the Commerce Identity API.
 * Requires the commerce.identity.readonly scope — returns nulls if the scope
 * is missing (old connection) or the call fails.
 */
export async function getSellerProfile(userId: string): Promise<SellerProfile> {
	const token = await getSellerToken(userId);
	if (!token) return { username: null, email: null };

	try {
		const res = await fetch('https://apiz.ebay.com/commerce/identity/v1/user/', {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
		});

		if (!res.ok) {
			if (res.status === 403 || res.status === 401) {
				// Missing scope or invalid token — not fatal
				console.warn(`[ebay-seller-auth] Identity API returned ${res.status} — user may need to reconnect for profile info`);
			} else {
				console.error(`[ebay-seller-auth] Identity API error (${res.status}):`, await res.text().catch(() => ''));
			}
			return { username: null, email: null };
		}

		const data = await res.json();
		return {
			username: data.username ?? null,
			email: data.email ?? null
		};
	} catch (err) {
		console.error('[ebay-seller-auth] Identity API network error:', err);
		void logEvent({ level: 'error', event: 'ebay.seller_auth.identity_api_network_error', error: err });
		return { username: null, email: null };
	}
}

export async function disconnectSeller(userId: string): Promise<void> {
	const adminClient = getServiceClient();
	if (!adminClient) return;
	await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
}
