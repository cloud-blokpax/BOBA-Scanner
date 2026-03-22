/**
 * Rate Limiting
 *
 * Primary: Upstash Redis (@upstash/ratelimit)
 * Fallback: In-memory Map (for when Redis is unavailable)
 *
 * Budget: ~2K Redis commands/day for rate limiting.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { env } from '$env/dynamic/private';

// ── Upstash Rate Limiters ───────────────────────────────────

let scanLimiter: Ratelimit | null = null;
let anonScanLimiter: Ratelimit | null = null;
let collectionLimiter: Ratelimit | null = null;

function initLimiters() {
	if (scanLimiter) return;

	const upstashUrl = env.UPSTASH_REDIS_REST_URL ?? '';
	const upstashToken = env.UPSTASH_REDIS_REST_TOKEN ?? '';
	if (!upstashUrl || !upstashToken) return;

	const redis = new Redis({ url: upstashUrl, token: upstashToken });

	// 20 scans per 60 seconds per authenticated user
	scanLimiter = new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(20, '60 s'),
		prefix: 'rl:scan'
	});

	// 5 scans per 60 seconds per anonymous IP (stricter to prevent abuse)
	anonScanLimiter = new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(5, '60 s'),
		prefix: 'rl:anon-scan'
	});

	// 60 collection updates per 60 seconds per user
	collectionLimiter = new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(60, '60 s'),
		prefix: 'rl:col'
	});
}

// ── In-Memory Fallback ──────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 60_000;
const MAX_SCAN_REQUESTS = 20;
const MAX_ANON_SCAN_REQUESTS = 5;
const MAX_COLLECTION_REQUESTS = 60;

function checkInMemory(key: string, maxRequests: number): boolean {
	const now = Date.now();
	const userData = rateLimitMap.get(key) || { count: 0, windowStart: now };

	if (now - userData.windowStart > WINDOW_MS) {
		userData.count = 0;
		userData.windowStart = now;
	}

	// Check limit BEFORE incrementing to avoid off-by-one
	// (otherwise request maxRequests+1 gets through before being blocked)
	if (userData.count >= maxRequests) {
		rateLimitMap.set(key, userData);
		return false;
	}

	userData.count++;
	rateLimitMap.set(key, userData);

	// Cleanup old entries periodically
	if (rateLimitMap.size > 1000) {
		for (const [k, v] of rateLimitMap) {
			if (now - v.windowStart > WINDOW_MS * 2) rateLimitMap.delete(k);
		}
	}

	return true;
}

// ── Public API ──────────────────────────────────────────────

export interface RateLimitResult {
	success: boolean;
	limit: number;
	remaining: number;
	reset: number;
}

/**
 * Check scan rate limit for a user.
 */
export async function checkScanRateLimit(userId: string): Promise<RateLimitResult> {
	initLimiters();

	if (scanLimiter) {
		try {
			const result = await scanLimiter.limit(userId);
			return {
				success: result.success,
				limit: result.limit,
				remaining: result.remaining,
				reset: result.reset
			};
		} catch (err) {
			console.debug('[rate-limit] Redis check failed, using in-memory fallback:', err);
		}
	}

	// In-memory fallback
	const key = `scan:${userId}`;
	const success = checkInMemory(key, MAX_SCAN_REQUESTS);
	const count = rateLimitMap.get(key)?.count || 0;
	return {
		success,
		limit: MAX_SCAN_REQUESTS,
		remaining: Math.max(0, MAX_SCAN_REQUESTS - count),
		reset: Date.now() + WINDOW_MS
	};
}

/**
 * Check scan rate limit for an anonymous IP (stricter than authenticated).
 */
export async function checkAnonScanRateLimit(ip: string): Promise<RateLimitResult> {
	initLimiters();

	if (anonScanLimiter) {
		try {
			const result = await anonScanLimiter.limit(ip);
			return {
				success: result.success,
				limit: result.limit,
				remaining: result.remaining,
				reset: result.reset
			};
		} catch (err) {
			console.debug('[rate-limit] Redis check failed, using in-memory fallback:', err);
		}
	}

	// In-memory fallback
	const key = `anon-scan:${ip}`;
	const success = checkInMemory(key, MAX_ANON_SCAN_REQUESTS);
	const count = rateLimitMap.get(key)?.count || 0;
	return {
		success,
		limit: MAX_ANON_SCAN_REQUESTS,
		remaining: Math.max(0, MAX_ANON_SCAN_REQUESTS - count),
		reset: Date.now() + WINDOW_MS
	};
}

/**
 * Check collection update rate limit for a user.
 */
export async function checkCollectionRateLimit(userId: string): Promise<RateLimitResult> {
	initLimiters();

	if (collectionLimiter) {
		try {
			const result = await collectionLimiter.limit(userId);
			return {
				success: result.success,
				limit: result.limit,
				remaining: result.remaining,
				reset: result.reset
			};
		} catch (err) {
			console.debug('[rate-limit] Redis check failed, using in-memory fallback:', err);
		}
	}

	const key = `col:${userId}`;
	const success = checkInMemory(key, MAX_COLLECTION_REQUESTS);
	const count = rateLimitMap.get(key)?.count || 0;
	return {
		success,
		limit: MAX_COLLECTION_REQUESTS,
		remaining: Math.max(0, MAX_COLLECTION_REQUESTS - count),
		reset: Date.now() + WINDOW_MS
	};
}
