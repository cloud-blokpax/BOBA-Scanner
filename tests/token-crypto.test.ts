/**
 * Unit tests for src/lib/server/auth/token-crypto.ts
 *
 * Verifies:
 *   - encrypt/decrypt round-trips when a key is configured
 *   - decrypt of legacy plaintext strings returns the input unchanged
 *   - decrypt fails closed on tampered ciphertext
 *   - encrypt returns null when no key is configured
 *
 * The key is configured by setting EBAY_TOKEN_ENCRYPTION_KEY before each
 * suite. Vitest doesn't run `import` ordering relative to env mutations
 * the way you'd expect, so we use `vi.resetModules()` between tests
 * that need a different key state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mutable env shape — vi.mock binds the live object so per-test mutations
// flow through every fresh `import('...')` after `vi.resetModules()`.
const mockEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({
	env: mockEnv
}));

beforeEach(() => {
	vi.resetModules();
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

afterEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe('token-crypto with configured key', () => {
	beforeEach(() => {
		mockEnv.EBAY_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes
	});

	it('round-trips a token through encrypt + decrypt', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		const ct = mod.encryptToken('v^1.1#abc.def');
		expect(ct).not.toBeNull();
		expect(ct!.startsWith('gcm1:')).toBe(true);
		expect(mod.decryptToken(ct)).toBe('v^1.1#abc.def');
	});

	it('produces a different ciphertext per call (random IV)', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		const a = mod.encryptToken('same-input');
		const b = mod.encryptToken('same-input');
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(a).not.toBe(b);
		expect(mod.decryptToken(a)).toBe('same-input');
		expect(mod.decryptToken(b)).toBe('same-input');
	});

	it('passes legacy plaintext (no version prefix) through decryptToken', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		// A real eBay refresh token format — no `gcm1:` prefix → plaintext
		expect(mod.decryptToken('v^1.1#i^1#XYZ')).toBe('v^1.1#i^1#XYZ');
	});

	it('returns null when ciphertext is tampered with', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		const ct = mod.encryptToken('payload')!;
		const parts = ct.split(':');
		// Flip a bit in the ciphertext segment
		const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3].slice(0, -2)}AA`;
		expect(mod.decryptToken(tampered)).toBeNull();
	});

	it('returns null when ciphertext has the wrong number of segments', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		expect(mod.decryptToken('gcm1:onlyone')).toBeNull();
		expect(mod.decryptToken('gcm1:a:b')).toBeNull();
	});

	it('reports configured', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		expect(mod.isTokenCryptoConfigured()).toBe(true);
	});
});

describe('token-crypto with no key', () => {
	beforeEach(() => {
		delete mockEnv.EBAY_TOKEN_ENCRYPTION_KEY;
	});

	it('encryptToken returns null', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		expect(mod.encryptToken('foo')).toBeNull();
	});

	it('decryptToken passes plaintext through', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		expect(mod.decryptToken('plaintext-token')).toBe('plaintext-token');
	});

	it('decryptToken returns null for ciphertext when key is missing', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		// A `gcm1:`-prefixed value with no key configured → cannot decrypt
		expect(mod.decryptToken('gcm1:aaa:bbb:ccc')).toBeNull();
	});

	it('reports not configured', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		expect(mod.isTokenCryptoConfigured()).toBe(false);
	});
});

describe('token-crypto with passphrase key', () => {
	beforeEach(() => {
		mockEnv.EBAY_TOKEN_ENCRYPTION_KEY = 'this-is-a-really-long-test-passphrase';
	});

	it('round-trips through hashed-passphrase derivation', async () => {
		const mod = await import('../src/lib/server/auth/token-crypto');
		const ct = mod.encryptToken('payload');
		expect(ct).not.toBeNull();
		expect(mod.decryptToken(ct)).toBe('payload');
	});
});
