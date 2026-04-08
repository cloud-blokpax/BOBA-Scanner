/**
 * Upstash Redis Service
 *
 * Three responsibilities:
 *   1. Shared perceptual hash cache (cross-user, ~8K commands/day)
 *   2. Rate limiting counters (~2K commands/day)
 *   3. Hot price data (top 50 cards)
 *
 * Budget: 10,000 commands/day on Upstash free tier.
 */

import { Redis } from '@upstash/redis';
import { env } from '$env/dynamic/private';
import type { HashCacheEntry } from '$lib/types';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
	const upstashUrl = (env.UPSTASH_REDIS_REST_URL ?? '').trim();
	const upstashToken = (env.UPSTASH_REDIS_REST_TOKEN ?? '').trim();
	if (!upstashUrl || !upstashToken) return null;
	if (!redis) {
		redis = new Redis({ url: upstashUrl, token: upstashToken });
	}
	return redis;
}

// ── Hash Cache ──────────────────────────────────────────────

const HASH_PREFIX = 'hash:';
const HASH_TTL = 60 * 60 * 24 * 30; // 30 days

/**
 * Look up a perceptual hash in Redis.
 * Returns card_id and confidence if found.
 */
export async function getHashFromRedis(
	phash: string
): Promise<{ card_id: string; confidence: number } | null> {
	const r = getRedis();
	if (!r) return null;

	try {
		const data = await r.get<{ card_id: string; confidence: number }>(HASH_PREFIX + phash);
		return data;
	} catch (err) {
		console.debug('[redis] Hash lookup failed:', err);
		return null;
	}
}

/**
 * Store a hash → card_id mapping in Redis.
 */
export async function setHashInRedis(
	phash: string,
	cardId: string,
	confidence: number
): Promise<void> {
	const r = getRedis();
	if (!r) return;

	try {
		await r.set(
			HASH_PREFIX + phash,
			{ card_id: cardId, confidence },
			{ ex: HASH_TTL }
		);
	} catch (err) {
		console.debug('[redis] Hash write failed:', err);
	}
}

// ── Hot Price Cache ─────────────────────────────────────────

const PRICE_PREFIX = 'price:';
const PRICE_TTL = 60 * 60 * 4; // 4 hours — BoBA card prices don't move fast enough for hourly refreshes

export async function getPriceFromRedis(cardId: string): Promise<Record<string, unknown> | null> {
	const r = getRedis();
	if (!r) return null;

	try {
		return await r.get<Record<string, unknown>>(PRICE_PREFIX + cardId);
	} catch (err) {
		console.debug('[redis] Price lookup failed:', err);
		return null;
	}
}

export async function setPriceInRedis(
	cardId: string,
	priceData: Record<string, unknown>
): Promise<void> {
	const r = getRedis();
	if (!r) return;

	try {
		await r.set(PRICE_PREFIX + cardId, priceData, { ex: PRICE_TTL });
	} catch (err) {
		console.debug('[redis] Price write failed:', err);
	}
}

// ── eBay API Daily Call Counter ─────────────────────────────

const EBAY_DAILY_LIMIT = 4500; // Leave 500 headroom from eBay's 5,000/day cap

// In-memory fallback when Redis is unavailable
const _ebayDailyFallback = { count: 0, date: '' };

/**
 * Check and increment the daily eBay API call counter.
 * Returns true if the call is allowed, false if the daily limit is exceeded.
 */
export async function checkEbayDailyLimit(): Promise<boolean> {
	const r = getRedis();
	const today = new Date().toISOString().slice(0, 10);

	if (!r) {
		// In-memory fallback — resets on cold starts, doesn't share across isolates,
		// but prevents a single isolate from making unlimited calls
		if (_ebayDailyFallback.date !== today) {
			_ebayDailyFallback.count = 0;
			_ebayDailyFallback.date = today;
		}
		_ebayDailyFallback.count++;
		return _ebayDailyFallback.count <= EBAY_DAILY_LIMIT;
	}

	try {
		const dailyKey = `ebay-calls:${new Date().toISOString().slice(0, 10)}`;
		const count = await r.incr(dailyKey);
		if (count === 1) await r.expire(dailyKey, 86400);
		return count <= EBAY_DAILY_LIMIT;
	} catch (err) {
		console.debug('[redis] eBay rate limit check failed:', err);
		return true; // Redis error = allow the call
	}
}

// ── Global Anonymous Scan Daily Cap ─────────────────────────

const GLOBAL_ANON_SCAN_DAILY_LIMIT = 500;

/**
 * Check and increment the global daily anonymous scan counter.
 * Returns true if the scan is allowed, false if the daily global cap is exceeded.
 * This prevents IP-rotation attacks from running up Claude API costs.
 */
/**
 * Check whether Redis is available for rate limiting.
 * Used as a circuit breaker: anonymous scans are blocked when Redis is down
 * to prevent unmetered Claude API usage.
 */
export function isRedisAvailable(): boolean {
	return getRedis() !== null;
}

// ── Harvest Configuration ───────────────────────────────────

const HARVEST_CONFIDENCE_KEY = 'harvest-config:confidence-threshold';

/**
 * Get the minimum confidence score required to accept a price.
 * Returns 0 if not set (accept everything).
 */
export async function getHarvestConfidenceThreshold(): Promise<number> {
	const r = getRedis();
	if (!r) return 0;

	try {
		const val = await r.get<number>(HARVEST_CONFIDENCE_KEY);
		return val ?? 0;
	} catch {
		return 0;
	}
}

/**
 * Set the minimum confidence score threshold (0–100 integer stored as 0.0–1.0 float).
 */
export async function setHarvestConfidenceThreshold(percent: number): Promise<void> {
	const r = getRedis();
	if (!r) throw new Error('Redis unavailable');

	const clamped = Math.max(0, Math.min(100, percent)) / 100;
	await r.set(HARVEST_CONFIDENCE_KEY, clamped);
}

export async function checkGlobalAnonScanLimit(): Promise<boolean> {
	const r = getRedis();
	if (!r) return true; // No Redis = no tracking, allow the call

	try {
		const dailyKey = `global-anon-scans:${new Date().toISOString().slice(0, 10)}`;
		const count = await r.incr(dailyKey);
		if (count === 1) await r.expire(dailyKey, 86400);
		return count <= GLOBAL_ANON_SCAN_DAILY_LIMIT;
	} catch (err) {
		console.debug('[redis] Global anon scan limit check failed:', err);
		return true; // Redis error = allow the call
	}
}
