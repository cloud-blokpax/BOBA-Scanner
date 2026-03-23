/**
 * Shared eBay OAuth token management.
 *
 * Used by all eBay-related API routes. Returns null when
 * eBay credentials are not configured.
 */

import { env } from '$env/dynamic/private';

let _token: string | null = null;
let _tokenExp = 0;

/**
 * Check if eBay API is configured.
 */
export function isEbayConfigured(): boolean {
	return !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET);
}

/**
 * Get a valid eBay OAuth token. Caches and auto-refreshes.
 * Throws if eBay is not configured.
 */
export async function getEbayToken(): Promise<string> {
	if (_token && Date.now() < _tokenExp) return _token;

	const clientId = env.EBAY_CLIENT_ID;
	const clientSecret = env.EBAY_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error('eBay credentials not configured');
	}

	const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
	const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
		method: 'POST',
		headers: {
			Authorization: `Basic ${creds}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
	});

	if (!response.ok) throw new Error(`eBay auth failed: ${response.status}`);
	const data = await response.json();
	_token = data.access_token;
	const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 7200;
	_tokenExp = Date.now() + expiresIn * 1000 - 60_000;
	return _token!;
}

/**
 * Execute a fetch against the eBay API with automatic token retry on 401.
 * Clears the cached token and retries once if eBay returns 401 Unauthorized.
 */
export async function ebayFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	const token = await getEbayToken();
	const headers = {
		...init?.headers,
		Authorization: `Bearer ${token}`,
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
	};

	const response = await fetch(url.toString(), { ...init, headers });

	if (response.status === 401) {
		// Token was revoked or expired prematurely — clear cache and retry once
		_token = null;
		_tokenExp = 0;
		const freshToken = await getEbayToken();
		const retryHeaders = {
			...init?.headers,
			Authorization: `Bearer ${freshToken}`,
			'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
		};
		return fetch(url.toString(), { ...init, headers: retryHeaders });
	}

	return response;
}
