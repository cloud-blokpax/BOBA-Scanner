/**
 * Integration tests for GET /api/config
 *
 * Tests the public config endpoint returns expected environment values
 * with correct caching headers.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
		PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
		PUBLIC_GOOGLE_CLIENT_ID: 'test-google-client-id'
	}
}));

import { GET } from '../src/routes/api/config/+server';

describe('GET /api/config', () => {
	it('returns public configuration values', async () => {
		const response = await GET({} as any);
		const body = await response.json();

		expect(body.supabaseUrl).toBe('https://test.supabase.co');
		expect(body.supabaseKey).toBe('test-anon-key');
		expect(body.googleClientId).toBe('test-google-client-id');
	});

	it('sets cache-control header to 5 minutes', async () => {
		const response = await GET({} as any);
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
	});

	it('does not expose private keys', async () => {
		const response = await GET({} as any);
		const body = await response.json();
		const text = JSON.stringify(body);

		expect(text).not.toContain('ANTHROPIC');
		expect(text).not.toContain('EBAY');
		expect(text).not.toContain('UPSTASH');
	});
});
