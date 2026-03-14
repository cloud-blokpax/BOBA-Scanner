/**
 * Integration tests for POST /api/scan
 *
 * Tests the scan endpoint's auth, validation, rate limiting, and Claude API
 * interaction with all external dependencies mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────

const mockCheckScanRateLimit = vi.fn();
vi.mock('$lib/server/rate-limit', () => ({
	checkScanRateLimit: (...args: unknown[]) => mockCheckScanRateLimit(...args)
}));

const mockSharp = vi.fn();
vi.mock('sharp', () => {
	const sharpInstance = {
		metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
		rotate: vi.fn().mockReturnThis(),
		resize: vi.fn().mockReturnThis(),
		jpeg: vi.fn().mockReturnThis(),
		toBuffer: vi.fn().mockResolvedValue(Buffer.from('clean-image-data'))
	};
	const sharp = (...args: unknown[]) => {
		mockSharp(...args);
		return sharpInstance;
	};
	sharp._instance = sharpInstance;
	return { default: sharp };
});

const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
	class APIError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	}
	return {
		default: class Anthropic {
			static APIError = APIError;
			messages = { create: mockAnthropicCreate };
		}
	};
});

vi.mock('$env/dynamic/private', () => ({
	env: { ANTHROPIC_API_KEY: 'test-key-123' }
}));

vi.mock('$lib/data/boba-config', () => ({
	BOBA_SCAN_CONFIG: {
		maxFileSize: 10_000_000,
		maxPixels: 16_000_000,
		allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp']
	}
}));

import { POST } from '../src/routes/api/scan/+server';

// ── Helpers ──────────────────────────────────────────────────

function makeLocals(user: { id: string } | null = { id: 'user-1' }) {
	return {
		safeGetSession: vi.fn().mockResolvedValue({ user }),
		supabase: {
			from: () => ({ insert: vi.fn().mockResolvedValue({}) })
		}
	};
}

function makeRequest(file?: File) {
	const formData = new FormData();
	if (file) formData.append('image', file);
	return new Request('http://localhost/api/scan', {
		method: 'POST',
		body: formData
	});
}

function makeImageFile(
	size = 1000,
	type = 'image/jpeg',
	name = 'card.jpg'
): File {
	const buffer = new ArrayBuffer(size);
	return new File([buffer], name, { type });
}

// ── Tests ────────────────────────────────────────────────────

describe('POST /api/scan', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckScanRateLimit.mockResolvedValue({
			success: true,
			limit: 20,
			remaining: 19,
			reset: Date.now() + 60000
		});
	});

	describe('authentication', () => {
		it('rejects unauthenticated requests with 401', async () => {
			const locals = makeLocals(null);
			const request = makeRequest(makeImageFile());
			await expect(
				POST({ request, locals } as any)
			).rejects.toMatchObject({ status: 401 });
		});

		it('allows authenticated requests', async () => {
			const locals = makeLocals({ id: 'user-1' });
			mockAnthropicCreate.mockResolvedValue({
				content: [{ type: 'text', text: '{"card_number":"BF-001","hero_name":"Bo","confidence":0.9}' }]
			});

			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(200);
		});
	});

	describe('rate limiting', () => {
		it('returns 429 when rate limited', async () => {
			const locals = makeLocals({ id: 'user-flood' });
			mockCheckScanRateLimit.mockResolvedValue({
				success: false,
				limit: 20,
				remaining: 0,
				reset: Date.now() + 30000
			});

			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(429);

			const body = await response.json();
			expect(body.error).toContain('Rate limited');
		});

		it('includes rate limit headers on 429', async () => {
			const locals = makeLocals({ id: 'user-flood' });
			mockCheckScanRateLimit.mockResolvedValue({
				success: false,
				limit: 20,
				remaining: 0,
				reset: 1234567890
			});

			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			expect(response.headers.get('X-RateLimit-Limit')).toBe('20');
			expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
			expect(response.headers.get('X-RateLimit-Reset')).toBe('1234567890');
		});
	});

	describe('input validation', () => {
		it('rejects requests without image file', async () => {
			const locals = makeLocals();
			const request = makeRequest(); // no file
			await expect(
				POST({ request, locals } as any)
			).rejects.toMatchObject({ status: 400 });
		});

		it('rejects files exceeding max size', async () => {
			const locals = makeLocals();
			const bigFile = makeImageFile(10_000_001);
			const request = makeRequest(bigFile);
			await expect(
				POST({ request, locals } as any)
			).rejects.toMatchObject({ status: 400 });
		});

		it('rejects invalid image types', async () => {
			const locals = makeLocals();
			const gifFile = new File([new ArrayBuffer(100)], 'card.gif', { type: 'image/gif' });
			const request = makeRequest(gifFile);
			await expect(
				POST({ request, locals } as any)
			).rejects.toMatchObject({ status: 400 });
		});
	});

	describe('Claude API integration', () => {
		it('returns parsed card data on successful identification', async () => {
			const locals = makeLocals();
			mockAnthropicCreate.mockResolvedValue({
				content: [{
					type: 'text',
					text: '{"card_number":"BF-108","hero_name":"Bo Jackson","confidence":0.95,"rarity":"rare"}'
				}]
			});

			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			const body = await response.json();

			expect(body.success).toBe(true);
			expect(body.method).toBe('claude');
			expect(body.card.card_number).toBe('BF-108');
			expect(body.card.hero_name).toBe('Bo Jackson');
		});

		it('handles JSON embedded in Claude response text', async () => {
			const locals = makeLocals();
			mockAnthropicCreate.mockResolvedValue({
				content: [{
					type: 'text',
					text: 'Here is the card info:\n```json\n{"card_number":"PL-46","hero_name":"Speed Demon","confidence":0.8}\n```'
				}]
			});

			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			const body = await response.json();

			expect(body.success).toBe(true);
			expect(body.card.card_number).toBe('PL-46');
		});

		it('returns 422 when Claude response has no JSON', async () => {
			const locals = makeLocals();
			mockAnthropicCreate.mockResolvedValue({
				content: [{ type: 'text', text: 'I cannot identify this card.' }]
			});

			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(422);

			const body = await response.json();
			expect(body.success).toBe(false);
		});

		it('returns 422 when Claude response has invalid JSON', async () => {
			const locals = makeLocals();
			mockAnthropicCreate.mockResolvedValue({
				content: [{ type: 'text', text: '{ invalid json here }' }]
			});

			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(422);
		});
	});
});
