/**
 * Price Cache Store
 */

import { idb } from '$lib/services/idb';
import type { PriceData } from '$lib/types';

export interface PriceResult {
	data: PriceData | null;
	errorReason: string | null;
}

// Key is `${cardId}:${variant}` so Paper and CF prices don't collide.
let _priceCache = $state<Map<string, PriceData>>(new Map());

export function priceCache(): Map<string, PriceData> { return _priceCache; }

function cacheKey(cardId: string, variant: string): string {
	return `${cardId}:${variant}`;
}

/** Return cached price_mid for a card ID, or null if not yet fetched. No API call triggered.
 *  Defaults to the Paper price — existing callers that don't specify a variant keep working. */
export function getCachedPriceMid(cardId: string, variant: string = 'paper'): number | null {
	const entry = _priceCache.get(cacheKey(cardId, variant));
	return entry?.price_mid ?? null;
}

const inflightRequests = new Map<string, Promise<PriceResult>>();

export async function getPrice(cardId: string, variant: string = 'paper'): Promise<PriceData | null> {
	const result = await getPriceWithReason(cardId, variant);
	return result.data;
}

export async function getPriceWithReason(cardId: string, variant: string = 'paper'): Promise<PriceResult> {
	const key = cacheKey(cardId, variant);
	const inflight = inflightRequests.get(key);
	if (inflight) return inflight;

	const promise = _fetchPrice(cardId, variant);
	inflightRequests.set(key, promise);
	try {
		return await promise;
	} finally {
		inflightRequests.delete(key);
	}
}

async function _fetchPrice(cardId: string, variant: string): Promise<PriceResult> {
	const key = cacheKey(cardId, variant);
	try {
		// IDB price store is keyed by card_id only — we can reuse it only for
		// the Paper variant. Non-Paper variants skip IDB and always go network.
		if (variant === 'paper') {
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
		const url = variant === 'paper'
			? `/api/price/${cardId}`
			: `/api/price/${cardId}?variant=${encodeURIComponent(variant)}`;
		const response = await fetch(url);
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			const reason = body.error || `Price lookup failed (${response.status})`;
			return { data: null, errorReason: reason };
		}

		const priceData = (await response.json()) as PriceData;

		try {
			if (variant === 'paper') await idb.setPrice(priceData);
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
