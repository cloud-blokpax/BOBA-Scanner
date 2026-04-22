/**
 * Price Cache Store
 */

import { idb } from '$lib/services/idb';
import type { PriceData } from '$lib/types';

export interface PriceResult {
	data: PriceData | null;
	errorReason: string | null;
}

// Key is `${cardId}:${parallel}` so Paper and CF prices don't collide.
// `parallel` is the human-readable name (e.g. "Paper", "Classic Foil") so
// the keyspace matches the database.
let _priceCache = $state<Map<string, PriceData>>(new Map());

export function priceCache(): Map<string, PriceData> { return _priceCache; }

function cacheKey(cardId: string, parallel: string): string {
	return `${cardId}:${parallel}`;
}

/** Return cached price_mid for a card ID, or null if not yet fetched. No API call triggered.
 *  Defaults to the Paper price — existing callers that don't specify a parallel keep working. */
export function getCachedPriceMid(cardId: string, parallel: string = 'Paper'): number | null {
	const entry = _priceCache.get(cacheKey(cardId, parallel));
	return entry?.price_mid ?? null;
}

const inflightRequests = new Map<string, Promise<PriceResult>>();

export async function getPrice(cardId: string, parallel: string = 'Paper'): Promise<PriceData | null> {
	const result = await getPriceWithReason(cardId, parallel);
	return result.data;
}

export async function getPriceWithReason(cardId: string, parallel: string = 'Paper'): Promise<PriceResult> {
	const key = cacheKey(cardId, parallel);
	const inflight = inflightRequests.get(key);
	if (inflight) return inflight;

	const promise = _fetchPrice(cardId, parallel);
	inflightRequests.set(key, promise);
	try {
		return await promise;
	} finally {
		inflightRequests.delete(key);
	}
}

async function _fetchPrice(cardId: string, parallel: string): Promise<PriceResult> {
	const key = cacheKey(cardId, parallel);
	const isPaper = parallel === 'Paper' || parallel.toLowerCase() === 'paper';
	try {
		// IDB price store is keyed by card_id only — we can reuse it only for
		// the Paper parallel. Non-Paper parallels skip IDB and always go network.
		if (isPaper) {
			const cached = await idb.getPrice(cardId, 14400_000);
			if (cached) {
				const priceData = cached as PriceData;
				const newMap = new Map(_priceCache);
				newMap.set(key, priceData);
				_priceCache = newMap;
				return { data: priceData, errorReason: null };
			}
		}
	} catch (err) {
		console.debug('[prices] IDB cache read failed:', err);
	}

	try {
		const url = isPaper
			? `/api/price/${cardId}`
			: `/api/price/${cardId}?parallel=${encodeURIComponent(parallel)}`;
		const response = await fetch(url);
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			const reason = body.error || `Price lookup failed (${response.status})`;
			return { data: null, errorReason: reason };
		}

		const priceData = (await response.json()) as PriceData;

		try {
			if (isPaper) await idb.setPrice(priceData);
		} catch (err) {
			console.debug('[prices] IDB cache write failed:', err);
		}

		const newMap = new Map(_priceCache);
		newMap.set(key, priceData);
		_priceCache = newMap;

		return { data: priceData, errorReason: null };
	} catch (err) {
		console.debug('[prices] Server fetch failed:', err);
		return { data: null, errorReason: 'Network error — check your connection' };
	}
}
