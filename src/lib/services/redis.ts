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

function getRedis(): Redis | null {
	const upstashUrl = env.UPSTASH_REDIS_REST_URL ?? '';
	const upstashToken = env.UPSTASH_REDIS_REST_TOKEN ?? '';
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
	} catch {
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
	} catch {
		// Non-critical
	}
}

// ── Hot Price Cache ─────────────────────────────────────────

const PRICE_PREFIX = 'price:';
const PRICE_TTL = 60 * 60; // 1 hour

export async function getPriceFromRedis(cardId: string): Promise<Record<string, unknown> | null> {
	const r = getRedis();
	if (!r) return null;

	try {
		return await r.get<Record<string, unknown>>(PRICE_PREFIX + cardId);
	} catch {
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
	} catch {
		// Non-critical
	}
}
