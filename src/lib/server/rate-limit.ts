/**
 * Rate Limiting — Declarative Configuration
 *
 * Primary: Upstash Redis (@upstash/ratelimit)
 * Fallback: In-memory Map (for when Redis is unavailable)
 *
 * Adding a new limiter = one line in the LIMITERS object.
 * Budget: ~2K Redis commands/day for rate limiting.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from './redis';

// ── Limiter definitions (single source of truth) ────────────
interface LimiterConfig {
	prefix: string;
	maxRequests: number;
	windowSeconds: number;
}

const LIMITERS: Record<string, LimiterConfig> = {
	scan:       { prefix: 'rl:scan',       maxRequests: 20, windowSeconds: 60 },
	anonScan:   { prefix: 'rl:anon-scan',  maxRequests: 5,  windowSeconds: 60 },
	anonPrice:  { prefix: 'rl:anon-price', maxRequests: 30, windowSeconds: 60 },
	collection: { prefix: 'rl:col',        maxRequests: 60, windowSeconds: 60 },
	mutation:   { prefix: 'rl:mut',        maxRequests: 10, windowSeconds: 60 },
	heavyMut:   { prefix: 'rl:hmut',       maxRequests: 3,  windowSeconds: 60 },
	// /api/diag accepts client error reports. Bots could try to flood it; cap
	// per-IP at a generous-but-bounded rate. Real users with chained errors
	// (one root cause cascading into many handlers) won't hit the cap.
	diag:       { prefix: 'rl:diag',       maxRequests: 30, windowSeconds: 60 },
};

// ── Redis limiters (lazy-initialized once) ──────────────────
const redisLimiters = new Map<string, Ratelimit>();
let redisInitDone = false;

function getRedisLimiter(name: string): Ratelimit | null {
	if (!redisInitDone) {
		redisInitDone = true;
		const redis = getRedis();
		if (!redis) {
			console.warn(
				'[rate-limit] Upstash Redis not configured — using in-memory fallback. ' +
				'Rate limiting will reset on every cold start and is ineffective across concurrent Vercel function instances.'
			);
		} else {
			for (const [key, config] of Object.entries(LIMITERS)) {
				redisLimiters.set(key, new Ratelimit({
					redis,
					limiter: Ratelimit.slidingWindow(config.maxRequests, `${config.windowSeconds} s`),
					prefix: config.prefix,
				}));
			}
		}
	}
	return redisLimiters.get(name) ?? null;
}

// ── In-memory fallback ──────────────────────────────────────
const memoryMap = new Map<string, { count: number; windowStart: number }>();

function checkInMemory(key: string, maxRequests: number, windowMs: number): boolean {
	const now = Date.now();
	const entry = memoryMap.get(key) ?? { count: 0, windowStart: now };

	if (now - entry.windowStart > windowMs) {
		entry.count = 0;
		entry.windowStart = now;
	}

	// Check limit BEFORE incrementing to avoid off-by-one
	if (entry.count >= maxRequests) {
		memoryMap.set(key, entry);
		return false;
	}

	entry.count++;
	memoryMap.set(key, entry);

	// Periodic cleanup to prevent memory leak
	if (memoryMap.size > 1000) {
		for (const [k, v] of memoryMap) {
			if (now - v.windowStart > windowMs * 2) memoryMap.delete(k);
		}
	}

	return true;
}

// ── Generic rate limit check ────────────────────────────────
export interface RateLimitResult {
	success: boolean;
	limit: number;
	remaining: number;
	reset: number;
}

async function checkLimit(limiterName: string, identifier: string): Promise<RateLimitResult> {
	const config = LIMITERS[limiterName];
	if (!config) throw new Error(`Unknown rate limiter: ${limiterName}`);

	const redisLimiter = getRedisLimiter(limiterName);
	if (redisLimiter) {
		try {
			const result = await redisLimiter.limit(identifier);
			return {
				success: result.success,
				limit: result.limit,
				remaining: result.remaining,
				reset: result.reset,
			};
		} catch (err) {
			console.debug(`[rate-limit] Redis check failed for ${limiterName}, using in-memory fallback:`, err);
		}
	}

	// In-memory fallback
	const windowMs = config.windowSeconds * 1000;
	const key = `${config.prefix}:${identifier}`;
	const success = checkInMemory(key, config.maxRequests, windowMs);
	const count = memoryMap.get(key)?.count ?? 0;
	return {
		success,
		limit: config.maxRequests,
		remaining: Math.max(0, config.maxRequests - count),
		reset: Date.now() + windowMs,
	};
}

// ── Named exports (identical API — zero consumer changes) ───
export const checkScanRateLimit = (userId: string) => checkLimit('scan', userId);
export const checkAnonScanRateLimit = (ip: string) => checkLimit('anonScan', ip);
export const checkAnonPriceRateLimit = (ip: string) => checkLimit('anonPrice', ip);
export const checkCollectionRateLimit = (userId: string) => checkLimit('collection', userId);
export const checkMutationRateLimit = (userId: string) => checkLimit('mutation', userId);
export const checkHeavyMutationRateLimit = (userId: string) => checkLimit('heavyMut', userId);
export const checkDiagRateLimit = (identifier: string) => checkLimit('diag', identifier);
