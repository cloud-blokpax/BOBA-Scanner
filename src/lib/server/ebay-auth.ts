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
	const accessToken = data.access_token;
	if (!accessToken || typeof accessToken !== 'string') {
		throw new Error('eBay token response missing access_token');
	}
	_token = accessToken;
	const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 7200;
	_tokenExp = Date.now() + expiresIn * 1000 - 60_000;
	return _token;
}

/**
 * Execute a fetch against the eBay API with:
 *   - Automatic token retry on 401
 *   - Exponential backoff retry on 429
 */
export async function ebayFetch(url: string | URL, init?: RequestInit): Promise<Response> {
	const MAX_429_RETRIES = 2;

	const makeHeaders = async () => ({
		...init?.headers,
		Authorization: `Bearer ${await getEbayToken()}`,
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
		'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=5339108029'
	});

	let response = await fetch(url.toString(), { ...init, headers: await makeHeaders() });

	// Handle 401: token expired — clear cache, get new token, retry once
	if (response.status === 401) {
		_token = null;
		_tokenExp = 0;
		response = await fetch(url.toString(), { ...init, headers: await makeHeaders() });
	}

	// Handle 429: rate limited — exponential backoff
	if (response.status === 429) {
		for (let attempt = 0; attempt < MAX_429_RETRIES; attempt++) {
			const retryAfter = response.headers.get('Retry-After');
			const waitMs = retryAfter
				? parseInt(retryAfter, 10) * 1000
				: 3000 * Math.pow(2, attempt); // 3s, 6s

			console.warn(`[ebay] 429 rate limited — waiting ${waitMs}ms (retry ${attempt + 1}/${MAX_429_RETRIES})`);
			await new Promise(r => setTimeout(r, waitMs));

			response = await fetch(url.toString(), { ...init, headers: await makeHeaders() });
			if (response.status !== 429) break;
		}
	}

	return response;
}
