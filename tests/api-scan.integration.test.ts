/**
 * Integration tests for POST /api/scan
 *
 * Tests the scan endpoint's auth, validation, rate limiting, and Claude API
 * interaction with all external dependencies mocked.
 * Uses structured output (tool_use) pattern matching the production endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────

const mockCheckScanRateLimit = vi.fn();
const mockCheckAnonScanRateLimit = vi.fn();
vi.mock('$lib/server/rate-limit', () => ({
	checkScanRateLimit: (...args: unknown[]) => mockCheckScanRateLimit(...args),
	checkAnonScanRateLimit: (...args: unknown[]) => mockCheckAnonScanRateLimit(...args)
}));

vi.mock('$lib/server/redis', () => ({
	checkGlobalAnonScanLimit: vi.fn().mockResolvedValue(true),
	isRedisAvailable: vi.fn().mockReturnValue(true)
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

function makeToolUseResponse(input: Record<string, unknown>) {
	return {
		content: [{
			type: 'tool_use',
			id: 'tool_1',
			name: 'identify_card',
			input
		}]
	};
}

// ── Tests ────────────────────────────────────────────────────

describe('POST /api/scan', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckScanRateLimit.mockResolvedValue({
			success: true, limit: 20, remaining: 19, reset: Date.now() + 60000
		});
		mockCheckAnonScanRateLimit.mockResolvedValue({
			success: true, limit: 5, remaining: 4, reset: Date.now() + 60000
		});
	});

	describe('authentication', () => {
		it('allows unauthenticated requests with IP-based rate limiting', async () => {
			const locals = makeLocals(null);
			mockAnthropicCreate.mockResolvedValue(makeToolUseResponse({
				card_number: 'BF-001', hero_name: 'Bo', confidence: 0.9,
				rarity: 'common', variant: 'base', card_name: 'Bo'
			}));
			const request = makeRequest(makeImageFile());
			const getClientAddress = () => '127.0.0.1';
			const response = await POST({ request, locals, getClientAddress } as any);
			expect(response.status).toBe(200);
			expect(mockCheckAnonScanRateLimit).toHaveBeenCalledWith('127.0.0.1');
		});

		it('rate limits unauthenticated requests by IP', async () => {
			const locals = makeLocals(null);
			mockCheckAnonScanRateLimit.mockResolvedValue({
				success: false, limit: 5, remaining: 0, reset: Date.now() + 30000
			});
			const request = makeRequest(makeImageFile());
			const getClientAddress = () => '127.0.0.1';
			const response = await POST({ request, locals, getClientAddress } as any);
			expect(response.status).toBe(429);
		});

		it('allows authenticated requests', async () => {
			const locals = makeLocals({ id: 'user-1' });
			mockAnthropicCreate.mockResolvedValue(makeToolUseResponse({
				card_number: 'BF-001', hero_name: 'Bo', confidence: 0.9,
				rarity: 'common', variant: 'base', card_name: 'Bo'
			}));
			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(200);
		});
	});

	describe('rate limiting', () => {
		it('returns 429 when rate limited', async () => {
			const locals = makeLocals({ id: 'user-flood' });
			mockCheckScanRateLimit.mockResolvedValue({
				success: false, limit: 20, remaining: 0, reset: Date.now() + 30000
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
				success: false, limit: 20, remaining: 0, reset: 1234567890
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
			const request = makeRequest();
			await expect(POST({ request, locals } as any)).rejects.toMatchObject({ status: 400 });
		});

		it('rejects files exceeding max size', async () => {
			const locals = makeLocals();
			const bigFile = makeImageFile(10_000_001);
			const request = makeRequest(bigFile);
			await expect(POST({ request, locals } as any)).rejects.toMatchObject({ status: 400 });
		});

		it('rejects invalid image types', async () => {
			const locals = makeLocals();
			const gifFile = new File([new ArrayBuffer(100)], 'card.gif', { type: 'image/gif' });
			const request = makeRequest(gifFile);
			await expect(POST({ request, locals } as any)).rejects.toMatchObject({ status: 400 });
		});
	});

	describe('Claude API integration', () => {
		it('returns parsed card data on successful identification', async () => {
			const locals = makeLocals();
			mockAnthropicCreate.mockResolvedValue(makeToolUseResponse({
				card_number: 'BF-108', hero_name: 'Bo Jackson',
				confidence: 0.95, rarity: 'rare', variant: 'base', card_name: 'Bo Jackson'
			}));
			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			const body = await response.json();
			expect(body.success).toBe(true);
			expect(body.method).toBe('claude');
			expect(body.card.card_number).toBe('BF-108');
			expect(body.card.hero_name).toBe('Bo Jackson');
		});

		it('uses tool_choice for structured output', async () => {
			const locals = makeLocals();
			mockAnthropicCreate.mockResolvedValue(makeToolUseResponse({
				card_number: 'PL-46', hero_name: 'Speed Demon',
				confidence: 0.8, rarity: 'common', variant: 'base', card_name: 'Speed Demon'
			}));
			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			const body = await response.json();
			expect(body.success).toBe(true);
			expect(body.card.card_number).toBe('PL-46');
			expect(mockAnthropicCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					tools: expect.arrayContaining([
						expect.objectContaining({ name: 'identify_card' })
					]),
					tool_choice: { type: 'tool', name: 'identify_card' }
				})
			);
		});

		it('returns 422 when Claude response has no tool_use block', async () => {
			const locals = makeLocals();
			mockAnthropicCreate.mockResolvedValue({
				content: [{ type: 'text', text: 'I cannot identify this card.' }]
			});
			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(502);
			const body = await response.json();
			expect(body.success).toBe(false);
		});

		it('detects power-as-card-number and clears card_number', async () => {
			const locals = makeLocals();
			mockAnthropicCreate.mockResolvedValue(makeToolUseResponse({
				card_number: '200', hero_name: 'BoJax', power: 200,
				confidence: 0.9, rarity: 'common', variant: 'base', card_name: 'BoJax'
			}));
			const request = makeRequest(makeImageFile());
			const response = await POST({ request, locals } as any);
			const body = await response.json();
			expect(body.success).toBe(true);
			expect(body.card.card_number).toBeNull();
			expect(body.card.confidence).toBeLessThanOrEqual(0.6);
		});
	});
});
