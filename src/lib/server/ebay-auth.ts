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
	_tokenExp = Date.now() + Math.max(data.expires_in - 60, 0) * 1000;
	return _token!;
}
