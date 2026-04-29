/**
 * AES-GCM encryption for WTP credentials.
 *
 * Credentials are encrypted at rest with a server-only master key
 * (WTP_CREDENTIAL_KEY env var, base64-encoded 32 bytes). Each record
 * uses a per-record IV stored alongside the ciphertext.
 */

import { env } from '$env/dynamic/private';
import { webcrypto } from 'node:crypto';

const ALGO = 'AES-GCM';

async function getMasterKey() {
	const b64 = env.WTP_CREDENTIAL_KEY ?? '';
	if (!b64) throw new Error('WTP_CREDENTIAL_KEY env var is not configured');
	const raw = Buffer.from(b64, 'base64');
	if (raw.byteLength !== 32) {
		throw new Error('WTP_CREDENTIAL_KEY must be base64-encoded 32 bytes (256-bit key)');
	}
	return webcrypto.subtle.importKey('raw', raw, ALGO, false, ['encrypt', 'decrypt']);
}

export interface EncryptedBlob {
	ciphertext: string; // base64
	iv: string; // base64
}

export async function encryptCredential(plaintext: string): Promise<EncryptedBlob> {
	const key = await getMasterKey();
	const iv = webcrypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const ct = await webcrypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
	return {
		ciphertext: Buffer.from(ct).toString('base64'),
		iv: Buffer.from(iv).toString('base64')
	};
}

export async function decryptCredential(blob: EncryptedBlob): Promise<string> {
	const key = await getMasterKey();
	const iv = Buffer.from(blob.iv, 'base64');
	const ct = Buffer.from(blob.ciphertext, 'base64');
	const pt = await webcrypto.subtle.decrypt({ name: ALGO, iv }, key, ct);
	return new TextDecoder().decode(pt);
}

export function isCryptoConfigured(): boolean {
	return !!env.WTP_CREDENTIAL_KEY;
}
