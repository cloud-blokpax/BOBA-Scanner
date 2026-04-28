/**
 * OAuth state token helper.
 *
 * Builds an HMAC-signed, base64url-encoded payload that can be passed through
 * a third-party OAuth provider's `state` query parameter. The provider echoes
 * `state` back verbatim on the callback, so anything we sign in here arrives
 * intact — even on browsers (iOS Safari ITP) that strip cookies on cross-site
 * redirects.
 *
 * Used by the eBay seller auth flow to carry a `returnTo` path so users land
 * back on the page they initiated Connect from, rather than always /settings.
 *
 * Security properties:
 *   - Tamper resistance: HMAC-SHA256 over the payload body. Constant-time
 *     comparison via timingSafeEqual prevents trivial timing attacks.
 *   - Replay window: 10 minutes from issuedAt.
 *   - Open-redirect protection: returnTo is sanitized to same-origin paths.
 *   - CSRF: a 16-byte random nonce is part of the signed payload.
 *
 * The OAUTH_STATE_SECRET env var is required. If unset, signState/verifyState
 * return null so callers can gracefully fall back to a non-state-aware path
 * (e.g. redirect to /settings) instead of 500ing.
 */

import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_RETURN_TO = '/settings';

export interface OAuthStatePayload {
	csrf: string;
	returnTo: string;
	issuedAt: number;
}

function getSecret(): string | null {
	const secret = env.OAUTH_STATE_SECRET ?? '';
	return secret.length >= 32 ? secret : null;
}

/**
 * Open-redirect protection: only allow same-origin paths.
 * Strips protocol-relative `//evil.com`, absolute URLs, and ensures leading /.
 */
export function sanitizeReturnTo(raw: unknown): string {
	if (typeof raw !== 'string') return DEFAULT_RETURN_TO;
	if (!raw.startsWith('/')) return DEFAULT_RETURN_TO;
	if (raw.startsWith('//')) return DEFAULT_RETURN_TO;
	// Reject anything that contains a protocol scheme even after the leading slash
	if (/^\/+\w+:/i.test(raw)) return DEFAULT_RETURN_TO;
	return raw;
}

/**
 * Create a signed state token. Returns null if OAUTH_STATE_SECRET is missing —
 * callers should fall back to their pre-state behavior in that case.
 */
export function signState(returnTo: string): string | null {
	const secret = getSecret();
	if (!secret) return null;

	const payload: OAuthStatePayload = {
		csrf: randomBytes(16).toString('hex'),
		returnTo: sanitizeReturnTo(returnTo),
		issuedAt: Date.now()
	};
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const sig = createHmac('sha256', secret).update(body).digest('base64url');
	return `${body}.${sig}`;
}

/**
 * Verify and parse an incoming state token. Returns null on any failure
 * (missing token, missing secret, bad signature, expired, malformed).
 */
export function verifyState(token: string | null | undefined): OAuthStatePayload | null {
	if (!token || !token.includes('.')) return null;
	const secret = getSecret();
	if (!secret) return null;

	const [body, sig] = token.split('.');
	if (!body || !sig) return null;

	const expected = createHmac('sha256', secret).update(body).digest('base64url');
	const sigBuf = Buffer.from(sig);
	const expectedBuf = Buffer.from(expected);
	if (sigBuf.length !== expectedBuf.length) return null;
	if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

	try {
		const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
		if (typeof payload.issuedAt !== 'number') return null;
		if (Date.now() - payload.issuedAt > MAX_AGE_MS) return null;
		payload.returnTo = sanitizeReturnTo(payload.returnTo);
		return payload;
	} catch {
		return null;
	}
}
