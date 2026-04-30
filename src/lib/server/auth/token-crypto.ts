/**
 * Symmetric token encryption helpers.
 *
 * Backs the encryption-at-rest claim the privacy page makes for stored
 * eBay OAuth credentials. Supabase already encrypts the underlying
 * volume; this layer narrows the blast radius of a leaked service-role
 * key from "all rows readable as plaintext" to "all rows readable only
 * if the operator also leaks EBAY_TOKEN_ENCRYPTION_KEY."
 *
 * Format: `gcm1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>`.
 *   - `gcm1`     — version prefix; lets future code rotate algorithms.
 *   - `iv`       — 12 random bytes, unique per ciphertext.
 *   - `tag`      — 16-byte AES-GCM authentication tag.
 *   - ciphertext — utf-8 plaintext encrypted with AES-256-GCM.
 *
 * Backward compatibility: `decryptToken` returns the input unchanged if
 * it doesn't carry the `gcm1:` prefix. This lets the rollout migrate
 * legacy plaintext rows on next refresh without forcing a one-shot
 * re-encryption of every stored token. Anything new written by the app
 * must go through `encryptToken`.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

const VERSION_PREFIX = 'gcm1:';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer | null {
	const raw = env.EBAY_TOKEN_ENCRYPTION_KEY ?? '';
	if (!raw) return null;
	// Accept either a 64-hex-char key (32 bytes) or a 32+ char passphrase
	// hashed to 32 bytes. Prefer hex — explicit is better than mystery.
	if (/^[0-9a-fA-F]{64}$/.test(raw)) {
		return Buffer.from(raw, 'hex');
	}
	if (raw.length >= 32) {
		// Use a length-extension-safe derivation: SHA-256 to 32 bytes.
		// Avoid pulling in crypto.scrypt — that adds a tunable cost we
		// don't need for a server-known passphrase.
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { createHash } = require('node:crypto') as typeof import('node:crypto');
		return createHash('sha256').update(raw, 'utf8').digest();
	}
	return null;
}

export function isTokenCryptoConfigured(): boolean {
	return getKey() !== null;
}

/**
 * Encrypt `plaintext` using AES-256-GCM. Returns the formatted ciphertext
 * (with version prefix) or `null` if no key is configured. Callers should
 * treat `null` as "fall back to storing plaintext"; they can also choose
 * to fail closed if encryption is required.
 */
export function encryptToken(plaintext: string): string | null {
	const key = getKey();
	if (!key) return null;

	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGO, key, iv);
	const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	if (tag.length !== TAG_BYTES) return null;
	return [
		VERSION_PREFIX.slice(0, -1), // 'gcm1'
		iv.toString('base64url'),
		tag.toString('base64url'),
		enc.toString('base64url')
	].join(':');
}

/**
 * Decrypt a previously-encrypted token. Returns:
 *   - the decrypted plaintext on success
 *   - the input unchanged if it doesn't carry the version prefix (legacy
 *     plaintext rows)
 *   - null if the input is prefixed but malformed/key-mismatched
 */
export function decryptToken(stored: string | null | undefined): string | null {
	if (!stored) return null;
	if (!stored.startsWith(VERSION_PREFIX)) return stored; // legacy plaintext
	const key = getKey();
	if (!key) return null;

	const parts = stored.split(':');
	if (parts.length !== 4) return null;
	try {
		const iv = Buffer.from(parts[1], 'base64url');
		const tag = Buffer.from(parts[2], 'base64url');
		const ct = Buffer.from(parts[3], 'base64url');
		if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
		const decipher = createDecipheriv(ALGO, key, iv);
		decipher.setAuthTag(tag);
		const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
		return dec.toString('utf8');
	} catch {
		return null;
	}
}
