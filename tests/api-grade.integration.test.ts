/**
 * Integration tests for POST /api/grade
 *
 * Tests the grading endpoint's auth, validation, rate limiting,
 * and Claude Vision response parsing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────

const mockCheckScanRateLimit = vi.fn();
const mockCheckAnonScanRateLimit = vi.fn();
vi.mock('$lib/server/rate-limit', () => ({
	checkScanRateLimit: (...args: unknown[]) => mockCheckScanRateLimit(...args),
	checkAnonScanRateLimit: (...args: unknown[]) => mockCheckAnonScanRateLimit(...args)
}));

vi.mock('$env/dynamic/private', () => ({
	env: { ANTHROPIC_API_KEY: 'test-key-123' }
}));

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
	return {
		default: class MockAnthropic {
			messages = { create: (...args: unknown[]) => mockCreate(...args) };
			constructor() {}
			static APIError = class APIError extends Error {
				status: number;
				constructor(status: number, message: string) { super(message); this.status = status; }
			};
		}
	};
});

vi.mock('$lib/server/grading-prompts', () => ({
	buildGradePrompt: vi.fn().mockReturnValue('Grade this card on a 1-10 scale.')
}));

import { POST } from '../src/routes/api/grade/+server';

// ── Helpers ──────────────────────────────────────────────────

function makeLocals(user: { id: string } | null = { id: 'user-1' }) {
	return {
		safeGetSession: vi.fn().mockResolvedValue({ user })
	};
}

function makeRequest(body: Record<string, unknown>) {
	return new Request('http://localhost/api/grade', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

// Valid small JPEG base64 string (starts with /9j/ = JPEG magic bytes FF D8 FF)
const VALID_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQ==';

// ── Tests ────────────────────────────────────────────────────

describe('POST /api/grade', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCheckScanRateLimit.mockResolvedValue({
			success: true,
			limit: 20,
			remaining: 19,
			reset: Date.now() + 60000
		});
		mockCheckAnonScanRateLimit.mockResolvedValue({
			success: true,
			limit: 5,
			remaining: 4,
			reset: Date.now() + 60000
		});
	});

	describe('authentication', () => {
		it('rejects unauthenticated requests with 401', async () => {
			const locals = makeLocals(null);
			const request = makeRequest({ imageData: VALID_BASE64 });
			const getClientAddress = () => '127.0.0.1';
			await expect(
				POST({ request, locals, getClientAddress } as any)
			).rejects.toMatchObject({ status: 401 });
		});
	});

	describe('rate limiting', () => {
		it('returns 429 when rate limited', async () => {
			const locals = makeLocals();
			mockCheckScanRateLimit.mockResolvedValue({
				success: false,
				limit: 20,
				remaining: 0,
				reset: Date.now() + 30000
			});

			const request = makeRequest({ imageData: VALID_BASE64 });
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(429);
		});
	});

	describe('input validation', () => {
		it('rejects invalid JSON body', async () => {
			const locals = makeLocals();
			const request = new Request('http://localhost/api/grade', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: 'not json'
			});
			await expect(
				POST({ request, locals } as any)
			).rejects.toMatchObject({ status: 400 });
		});

		it('rejects missing imageData', async () => {
			const locals = makeLocals();
			const request = makeRequest({});
			await expect(
				POST({ request, locals } as any)
			).rejects.toMatchObject({ status: 400 });
		});

		it('rejects non-base64 imageData', async () => {
			const locals = makeLocals();
			const request = makeRequest({ imageData: '<script>alert("xss")</script>' });
			await expect(
				POST({ request, locals } as any)
			).rejects.toMatchObject({ status: 400 });
		});
	});

	describe('Claude grading response', () => {
		it('returns parsed grade result on success', async () => {
			const locals = makeLocals();
			mockCreate.mockResolvedValue({
				content: [{
					type: 'text',
					text: JSON.stringify({
						grade: 8.5,
						grade_label: 'NM-MT+',
						confidence: 0.85,
						corners: 'Sharp corners with minimal wear',
						edges: 'Clean edges',
						surface: 'No scratches visible',
						front_centering: '52/48',
						back_centering: '50/50',
						summary: 'High-grade card with excellent condition',
						submit_recommendation: 'yes'
					})
				}]
			});

			const request = makeRequest({ imageData: VALID_BASE64 });
			const response = await POST({ request, locals } as any);
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(body.grade).toBe(8.5);
			expect(body.grade_label).toBe('NM-MT+');
			expect(body.submit_recommendation).toBe('yes');
		});

		it('returns 422 when Claude response has no JSON', async () => {
			const locals = makeLocals();
			mockCreate.mockResolvedValue({
				content: [{ type: 'text', text: 'Sorry, I cannot grade this image.' }]
			});

			const request = makeRequest({ imageData: VALID_BASE64 });
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(422);
		});

		it('returns 422 when grade value is out of range', async () => {
			const locals = makeLocals();
			mockCreate.mockResolvedValue({
				content: [{
					type: 'text',
					text: '{"grade": 15, "grade_label": "Invalid"}'
				}]
			});

			const request = makeRequest({ imageData: VALID_BASE64 });
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(422);
		});

		it('handles Claude API overload (529) by rethrowing as 503', async () => {
			const locals = makeLocals();
			const Anthropic = (await import('@anthropic-ai/sdk')).default;
			mockCreate.mockRejectedValue(
				Object.assign(new Error('Overloaded'), { status: 529, name: 'APIError' })
			);
			// Make the error look like an APIError instance
			const apiErr = new (Anthropic as any).APIError(529, 'Overloaded');
			mockCreate.mockRejectedValue(apiErr);

			const request = makeRequest({ imageData: VALID_BASE64 });
			await expect(
				POST({ request, locals } as any)
			).rejects.toMatchObject({ status: 503 });
		});

		it('handles Claude API errors as 502', async () => {
			const locals = makeLocals();
			const Anthropic = (await import('@anthropic-ai/sdk')).default;
			const apiErr = new (Anthropic as any).APIError(500, 'Server error');
			mockCreate.mockRejectedValue(apiErr);

			const request = makeRequest({ imageData: VALID_BASE64 });
			await expect(
				POST({ request, locals } as any)
			).rejects.toMatchObject({ status: 502 });
		});
	});

	describe('multi-image support', () => {
		it('accepts cornerRegionData and centeringImageData', async () => {
			const locals = makeLocals();
			mockCreate.mockResolvedValue({
				content: [{
					type: 'text',
					text: '{"grade":9,"grade_label":"Mint","confidence":0.9,"corners":"Perfect","edges":"Clean","surface":"Pristine","front_centering":"50/50","back_centering":"50/50","summary":"Gem mint","submit_recommendation":"yes"}'
				}]
			});

			const request = makeRequest({
				imageData: VALID_BASE64,
				cornerRegionData: VALID_BASE64,
				centeringImageData: VALID_BASE64
			});
			const response = await POST({ request, locals } as any);
			expect(response.status).toBe(200);

			// Should have sent 3 images + 1 text to Claude via SDK
			const createCall = mockCreate.mock.calls[0][0];
			const imageContent = createCall.messages[0].content.filter(
				(c: { type: string }) => c.type === 'image'
			);
			expect(imageContent.length).toBe(3);
		});
	});
});
