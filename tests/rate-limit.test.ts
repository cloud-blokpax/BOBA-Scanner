/**
 * Tests for rate limiting — in-memory fallback path.
 *
 * We mock out Upstash Redis so all tests exercise the in-memory rate limiter.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the shared Redis client to return null (forces in-memory fallback)
vi.mock('$lib/server/redis', () => ({
	getRedis: () => null
}));

// Mock @upstash/ratelimit
vi.mock('@upstash/ratelimit', () => ({
	Ratelimit: class {
		static slidingWindow() {
			return {};
		}
	}
}));

import { checkScanRateLimit, checkCollectionRateLimit } from '$lib/server/rate-limit';

describe('in-memory rate limiting', () => {
	// Reset module state between tests by re-importing
	beforeEach(() => {
		vi.resetModules();
	});

	it('allows requests under the limit', async () => {
		const result = await checkScanRateLimit('user-1');
		expect(result.success).toBe(true);
		expect(result.limit).toBe(20);
		expect(result.remaining).toBeGreaterThan(0);
	});

	it('tracks remaining count correctly', async () => {
		const r1 = await checkScanRateLimit('user-remaining-test');
		expect(r1.remaining).toBe(19); // 20 - 1

		const r2 = await checkScanRateLimit('user-remaining-test');
		expect(r2.remaining).toBe(18); // 20 - 2
	});

	it('blocks after exceeding scan limit', async () => {
		const userId = 'user-scan-flood';

		// Make 20 requests (should all succeed)
		for (let i = 0; i < 20; i++) {
			const result = await checkScanRateLimit(userId);
			expect(result.success).toBe(true);
		}

		// 21st request should be blocked
		const blocked = await checkScanRateLimit(userId);
		expect(blocked.success).toBe(false);
		expect(blocked.remaining).toBe(0);
	});

	it('collection limit is higher than scan limit', async () => {
		const userId = 'user-col-test';

		// Make 25 requests (exceeds scan limit of 20, but under collection limit of 60)
		for (let i = 0; i < 25; i++) {
			const result = await checkCollectionRateLimit(userId);
			expect(result.success).toBe(true);
		}

		expect((await checkCollectionRateLimit(userId)).remaining).toBe(34); // 60 - 26
	});

	it('different users have independent limits', async () => {
		// Fill up user-a's scan budget
		for (let i = 0; i < 20; i++) {
			await checkScanRateLimit('user-a');
		}

		// user-a should be blocked
		const blockedA = await checkScanRateLimit('user-a');
		expect(blockedA.success).toBe(false);

		// user-b should still be fine
		const okB = await checkScanRateLimit('user-b');
		expect(okB.success).toBe(true);
	});

	it('returns proper reset timestamp', async () => {
		const now = Date.now();
		const result = await checkScanRateLimit('user-reset');
		expect(result.reset).toBeGreaterThan(now);
	});
});
