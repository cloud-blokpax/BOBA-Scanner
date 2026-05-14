/**
 * eBay Seller OAuth — Authorization Code Grant
 *
 * Handles per-user seller authorization for the Inventory API.
 * Separate from ebay-auth.ts which handles app-level Browse API tokens.
 *
 * Tokens are stored exclusively as AES-256-GCM ciphertext in the
 * access_token_ciphertext / refresh_token_ciphertext columns of
 * public.ebay_seller_tokens. The legacy plaintext columns were dropped
 * in the 2.18 cleanup pass — any row reaching this code without
 * ciphertext is treated as unrecoverable (user must reconnect).
 */

import { env } from '$env/dynamic/private';
import { getAdminClient } from '$lib/server/supabase-admin';
import { logEvent } from '$lib/server/diagnostics';
import {
	encryptToken,
	decryptToken,
	isEbayCryptoConfigured
} from '$lib/server/ebay-crypto';
import { logEbayUsage } from '$lib/server/ebay-usage-log';
import { getRedis } from '$lib/server/redis';

const EBAY_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_REVOKE_URL = 'https://api.ebay.com/identity/v1/oauth2/revoke';

// Minimal scopes — only request what the app actually uses.
// sell.inventory: read + write inventory items and offers (covers .readonly).
// sell.account: read + write business policies (covers .readonly).
// commerce.identity.readonly: seller username + email shown in settings UI.
// api_scope: base scope required on every authorization request.
const SELLER_SCOPES = [
	'https://api.ebay.com/oauth/api_scope',
	'https://api.ebay.com/oauth/api_scope/sell.inventory',
	'https://api.ebay.com/oauth/api_scope/sell.account',
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

export function buildAuthUrl(state: string, opts: { forceLogin?: boolean } = {}): string {
	const params = new URLSearchParams({
		client_id: env.EBAY_CLIENT_ID ?? '',
		redirect_uri: env.EBAY_RUNAME ?? '',
		response_type: 'code',
		scope: SELLER_SCOPES,
		state
	});
	// Force eBay to show its login picker even if the browser already has an
	// eBay session cookie. Without this, a user who disconnects and reconnects
	// is silently re-attached to the same eBay account they were already signed
	// into — they can't actually switch accounts.
	if (opts.forceLogin) params.set('prompt', 'login');
	return `${EBAY_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string, userId: string): Promise<string | null> {
	const exchangeStart = Date.now();
	const response = await fetch(EBAY_TOKEN_URL, {
		method: 'POST',
		headers: { Authorization: `Basic ${getBasicAuth()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: env.EBAY_RUNAME ?? ''
		}).toString()
	});

	void logEbayUsage({
		userId,
		endpoint: 'oauth.exchange_code',
		httpMethod: 'POST',
		httpStatus: response.status,
		success: response.ok,
		errorMessage: response.ok ? null : `HTTP ${response.status}`,
		requestPath: '/auth/ebay/callback',
		durationMs: Date.now() - exchangeStart
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

	if (!isEbayCryptoConfigured()) {
		console.error('[ebay-seller-auth] EBAY_CREDENTIAL_KEY not configured — refusing to store token');
		void logEvent({ level: 'error', event: 'ebay.seller_auth.crypto_not_configured' });
		throw new Error('eBay credential encryption is not configured');
	}

	const accessEnc = await encryptToken(data.access_token);
	const refreshEnc = await encryptToken(data.refresh_token);

	const { error: upsertError } = await adminClient.from('ebay_seller_tokens').upsert({
		user_id: userId,
		access_token_ciphertext: accessEnc.ciphertext,
		access_token_iv: accessEnc.iv,
		access_token_expires_at: accessExpires.toISOString(),
		refresh_token_ciphertext: refreshEnc.ciphertext,
		refresh_token_iv: refreshEnc.iv,
		refresh_token_expires_at: refreshExpires.toISOString(),
		scopes: SELLER_SCOPES,
		updated_at: new Date().toISOString()
	}, { onConflict: 'user_id' });

	if (upsertError) {
		console.error('[ebay-seller-auth] Token storage failed:', upsertError);
		throw new Error('Failed to store eBay tokens');
	}

	// Populate cached profile + readiness immediately so the settings UI
	// can show "Connected as @username" and a setup-needed warning without
	// firing eBay API calls on every page load.
	// Non-blocking — if this throws, the row is still created with NULL cache
	// columns and the Test button can refresh later.
	try {
		await refreshSellerProfileCache(userId);
	} catch (err) {
		console.warn('[ebay-seller-auth] Initial profile cache refresh failed (non-blocking):', err instanceof Error ? err.message : err);
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

type CipherFields = {
	access_token_ciphertext: string | null;
	access_token_iv: string | null;
	refresh_token_ciphertext: string | null;
	refresh_token_iv: string | null;
};

async function readAccessTokenFromRow(row: CipherFields, userId: string): Promise<string | null> {
	if (!row.access_token_ciphertext || !row.access_token_iv) {
		console.error('[ebay-seller-auth] No access token ciphertext for user', userId);
		void logEvent({
			level: 'error',
			event: 'ebay.seller_auth.missing_ciphertext',
			context: { user_id: userId, field: 'access_token' }
		});
		return null;
	}
	try {
		return await decryptToken({
			ciphertext: row.access_token_ciphertext,
			iv: row.access_token_iv
		});
	} catch (err) {
		console.error('[ebay-seller-auth] Access token decrypt failed:', err instanceof Error ? err.message : err);
		void logEvent({ level: 'error', event: 'ebay.seller_auth.decrypt_failed', context: { user_id: userId, field: 'access_token' } });
		return null;
	}
}

async function readRefreshTokenFromRow(row: CipherFields, userId: string): Promise<string | null> {
	if (!row.refresh_token_ciphertext || !row.refresh_token_iv) {
		console.error('[ebay-seller-auth] No refresh token ciphertext for user', userId);
		void logEvent({
			level: 'error',
			event: 'ebay.seller_auth.missing_ciphertext',
			context: { user_id: userId, field: 'refresh_token' }
		});
		return null;
	}
	try {
		return await decryptToken({
			ciphertext: row.refresh_token_ciphertext,
			iv: row.refresh_token_iv
		});
	} catch (err) {
		console.error('[ebay-seller-auth] Refresh token decrypt failed:', err instanceof Error ? err.message : err);
		void logEvent({ level: 'error', event: 'ebay.seller_auth.decrypt_failed', context: { user_id: userId, field: 'refresh_token' } });
		return null;
	}
}

async function waitAndReread(
	adminClient: NonNullable<ReturnType<typeof getServiceClient>>,
	userId: string
): Promise<string | null> {
	const deadline = Date.now() + REFRESH_WAIT_MAX_MS;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, REFRESH_WAIT_INTERVAL_MS));
		const { data: row } = await adminClient
			.from('ebay_seller_tokens')
			.select('access_token_ciphertext, access_token_iv, access_token_expires_at, refresh_token_ciphertext, refresh_token_iv')
			.eq('user_id', userId)
			.maybeSingle();
		if (
			row &&
			Date.now() < new Date(row.access_token_expires_at).getTime() - 60_000
		) {
			return readAccessTokenFromRow(row as CipherFields, userId);
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
		return readAccessTokenFromRow(tokenRow as CipherFields, userId);
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
		const refreshToken = await readRefreshTokenFromRow(tokenRow as CipherFields, userId);
		if (!refreshToken) {
			console.error('[ebay-seller-auth] No refresh token available for user', userId);
			return null;
		}

		const refreshStart = Date.now();
		const response = await fetch(EBAY_TOKEN_URL, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${getBasicAuth()}`,
				'Content-Type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				scope: SELLER_SCOPES
			}).toString()
		});

		void logEbayUsage({
			userId,
			endpoint: 'oauth.refresh_token',
			httpMethod: 'POST',
			httpStatus: response.status,
			success: response.ok,
			errorMessage: response.ok ? null : `HTTP ${response.status}`,
			requestPath: 'internal:getSellerToken',
			durationMs: Date.now() - refreshStart
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

		const refreshedAccessEnc = await encryptToken(data.access_token);
		const update: Record<string, unknown> = {
			access_token_ciphertext: refreshedAccessEnc.ciphertext,
			access_token_iv: refreshedAccessEnc.iv,
			access_token_expires_at: new Date(
				Date.now() + Math.max(data.expires_in ?? 7200, 60) * 1000
			).toISOString(),
			updated_at: new Date().toISOString()
		};
		// eBay sometimes rotates the refresh token too. Persist the rotation.
		if (typeof data.refresh_token === 'string' && data.refresh_token.length > 0) {
			const rotatedRefreshEnc = await encryptToken(data.refresh_token);
			update.refresh_token_ciphertext = rotatedRefreshEnc.ciphertext;
			update.refresh_token_iv = rotatedRefreshEnc.iv;
			if (typeof data.refresh_token_expires_in === 'number') {
				update.refresh_token_expires_at = new Date(
					Date.now() + data.refresh_token_expires_in * 1000
				).toISOString();
			}
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
		const privilegeStart = Date.now();
		const res = await fetch('https://api.ebay.com/sell/account/v1/privilege', {
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
		});
		void logEbayUsage({
			userId,
			endpoint: 'sell.account.get_privilege',
			httpMethod: 'GET',
			httpStatus: res.status,
			success: res.ok,
			errorMessage: res.ok ? null : `HTTP ${res.status}`,
			requestPath: 'internal:validateSellerConnection',
			durationMs: Date.now() - privilegeStart
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

		// The user pressed "Test" — also refresh the cached profile + readiness
		// flag so the settings UI reflects the latest eBay-side state.
		void refreshSellerProfileCache(userId);

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
	/** Stable eBay user identifier — used to match account-deletion notifications. */
	userId: string | null;
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
	if (!token) return { userId: null, username: null, email: null };

	try {
		const identityStart = Date.now();
		const res = await fetch('https://apiz.ebay.com/commerce/identity/v1/user/', {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
		});
		void logEbayUsage({
			userId,
			endpoint: 'commerce.identity.get_user',
			httpMethod: 'GET',
			httpStatus: res.status,
			success: res.ok,
			errorMessage: res.ok ? null : `HTTP ${res.status}`,
			requestPath: 'internal:getSellerProfile',
			durationMs: Date.now() - identityStart
		});

		if (!res.ok) {
			if (res.status === 403 || res.status === 401) {
				// Missing scope or invalid token — not fatal
				console.warn(`[ebay-seller-auth] Identity API returned ${res.status} — user may need to reconnect for profile info`);
			} else {
				console.error(`[ebay-seller-auth] Identity API error (${res.status}):`, await res.text().catch(() => ''));
			}
			return { userId: null, username: null, email: null };
		}

		const data = await res.json();
		return {
			userId: data.userId ?? null,
			username: data.username ?? null,
			email: data.email ?? null
		};
	} catch (err) {
		console.error('[ebay-seller-auth] Identity API network error:', err);
		void logEvent({ level: 'error', event: 'ebay.seller_auth.identity_api_network_error', error: err });
		return { userId: null, username: null, email: null };
	}
}

export async function disconnectSeller(userId: string): Promise<void> {
	const adminClient = getServiceClient();
	if (!adminClient) return;

	// Best-effort: revoke the refresh token at eBay so it stops working at the
	// source even if it was previously exfiltrated. If revocation fails (network
	// error, eBay outage, key not configured), we still proceed with local
	// deletion — the alternative is leaving stale rows around when revocation
	// is flaky.
	try {
		const { data: tokenRow } = await adminClient
			.from('ebay_seller_tokens')
			.select('refresh_token_ciphertext, refresh_token_iv')
			.eq('user_id', userId)
			.maybeSingle();

		if (tokenRow) {
			let refreshToken: string | null = null;
			if (tokenRow.refresh_token_ciphertext && tokenRow.refresh_token_iv) {
				try {
					refreshToken = await decryptToken({
						ciphertext: tokenRow.refresh_token_ciphertext,
						iv: tokenRow.refresh_token_iv
					});
				} catch (err) {
					console.warn('[ebay-seller-auth] Refresh token decrypt failed during disconnect — proceeding with local delete only:', err instanceof Error ? err.message : err);
				}
			}

			if (refreshToken) {
				const revokeStart = Date.now();
				const revokeRes = await fetch(EBAY_REVOKE_URL, {
					method: 'POST',
					headers: {
						Authorization: `Basic ${getBasicAuth()}`,
						'Content-Type': 'application/x-www-form-urlencoded'
					},
					body: new URLSearchParams({
						token: refreshToken,
						token_type_hint: 'refresh_token'
					}).toString()
				});

				void logEbayUsage({
					userId,
					endpoint: 'oauth.revoke_token',
					httpMethod: 'POST',
					httpStatus: revokeRes.status,
					success: revokeRes.ok,
					errorMessage: revokeRes.ok ? null : `HTTP ${revokeRes.status}`,
					requestPath: 'internal:disconnectSeller',
					durationMs: Date.now() - revokeStart
				});

				if (!revokeRes.ok) {
					const body = await revokeRes.text().catch(() => '');
					console.warn(
						`[ebay-seller-auth] Token revocation returned ${revokeRes.status} (proceeding with local delete):`,
						body.slice(0, 200)
					);
					void logEvent({
						level: 'warn',
						event: 'ebay.seller_auth.revoke_non_2xx',
						context: { user_id: userId, status: revokeRes.status }
					});
				} else {
					console.log('[ebay-seller-auth] Refresh token revoked at eBay for user', userId);
				}
			}
		}
	} catch (err) {
		console.warn('[ebay-seller-auth] Token revocation request failed (proceeding with local delete):', err instanceof Error ? err.message : err);
		void logEvent({
			level: 'warn',
			event: 'ebay.seller_auth.revoke_threw',
			error: err,
			context: { user_id: userId }
		});
	}

	await adminClient.from('ebay_seller_tokens').delete().eq('user_id', userId);
}

// ─── Seller account readiness ────────────────────────────────────────────────
//
// eBay's Inventory API requires a fully-onboarded seller: Managed Payments
// enrolled, identity verified, payment method on file. Brand-new accounts pass
// OAuth but fail the first `sell.inventory.put_item` call with HTTP 500 +
// errorId 25001 ("A system error has occurred. Core Inventory Service internal
// error"). The `/sell/account/v1/privilege` endpoint is the cheapest signal
// for whether the account is Inventory-API-ready.

export interface SellerReadiness {
	ready: boolean;
	message: string | null;
	sellingLimit?: { amount: number; quantity: number };
}

/**
 * Probe the seller's account readiness via the privilege endpoint.
 * Returns ready=false with a human-readable message when eBay rejects the
 * call or the response indicates a $0/0-item selling limit (typical for
 * un-enrolled accounts).
 */
export async function checkSellerReadiness(token: string, userId: string): Promise<SellerReadiness> {
	const start = Date.now();
	try {
		const res = await fetch('https://api.ebay.com/sell/account/v1/privilege', {
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
		});
		void logEbayUsage({
			userId,
			endpoint: 'sell.account.get_privilege',
			httpMethod: 'GET',
			httpStatus: res.status,
			success: res.ok,
			errorMessage: res.ok ? null : `HTTP ${res.status}`,
			requestPath: 'internal:checkSellerReadiness',
			durationMs: Date.now() - start
		});

		if (!res.ok) {
			return {
				ready: false,
				message: `eBay rejected the readiness check (HTTP ${res.status}). Visit eBay Seller Hub to complete seller account setup.`
			};
		}

		const data = await res.json();
		const limitAmount = data.sellingLimit?.amount?.value ?? 0;
		const limitQuantity = data.sellingLimit?.quantity ?? 0;

		// $0 + 0 items typically means the seller account isn't fully enrolled
		// (Managed Payments missing, identity verification pending, etc.).
		if (limitAmount === 0 && limitQuantity === 0) {
			return {
				ready: false,
				message: 'Your eBay seller account needs setup before listings can be created. Open eBay Seller Hub, complete Managed Payments enrollment, and verify your identity.',
				sellingLimit: { amount: limitAmount, quantity: limitQuantity }
			};
		}

		return {
			ready: true,
			message: null,
			sellingLimit: { amount: limitAmount, quantity: limitQuantity }
		};
	} catch (err) {
		console.error('[ebay-seller-auth] Readiness check threw:', err);
		void logEvent({ level: 'warn', event: 'ebay.seller_auth.readiness_check_threw', error: err, userId });
		// Network error — don't punish the user; treat as unknown.
		return { ready: false, message: 'Could not reach eBay to check seller readiness. Try again later.' };
	}
}

/**
 * Refresh the cached profile + readiness on the ebay_seller_tokens row.
 * Called from exchangeCode (on connect) and from the user-triggered Test
 * button (validateSellerConnection). The status endpoint never calls this —
 * it reads the cache directly to avoid an eBay API hit on every page load.
 */
export async function refreshSellerProfileCache(userId: string): Promise<void> {
	const adminClient = getServiceClient();
	if (!adminClient) return;

	const token = await getSellerToken(userId);
	if (!token) return;

	const [profile, readiness] = await Promise.all([
		getSellerProfile(userId),
		checkSellerReadiness(token, userId)
	]);

	const { error: updateErr } = await adminClient
		.from('ebay_seller_tokens')
		.update({
			ebay_user_id: profile.userId,
			ebay_username: profile.username,
			ebay_email: profile.email,
			seller_account_ready: readiness.ready,
			seller_account_status_message: readiness.message,
			profile_last_refreshed_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		})
		.eq('user_id', userId);

	if (updateErr) {
		console.error('[ebay-seller-auth] Profile cache write failed:', updateErr.message);
		void logEvent({
			level: 'warn',
			event: 'ebay.seller_auth.profile_cache_write_failed',
			error: updateErr,
			userId,
			context: { ready: readiness.ready, username: profile.username }
		});
	}
}
