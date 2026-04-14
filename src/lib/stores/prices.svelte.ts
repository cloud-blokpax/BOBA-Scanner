/**
 * Price Cache Store
 */

import { idb } from '$lib/services/idb';
import type { PriceData } from '$lib/types';

export interface PriceResult {
	data: PriceData | null;
	errorReason: string | null;
}

let _priceCache = $state<Map<string, PriceData>>(new Map());

export function priceCache(): Map<string, PriceData> { return _priceCache; }

/** Return cached price_mid for a card ID, or null if not yet fetched. No API call triggered. */
export function getCachedPriceMid(cardId: string): number | null {
	const entry = _priceCache.get(cardId);
	return entry?.price_mid ?? null;
}

const inflightRequests = new Map<string, Promise<PriceResult>>();

export async function getPrice(cardId: string): Promise<PriceData | null> {
	const result = await getPriceWithReason(cardId);
	return result.data;
}

export async function getPriceWithReason(cardId: string): Promise<PriceResult> {
	const inflight = inflightRequests.get(cardId);
	if (inflight) return inflight;

	const promise = _fetchPrice(cardId);
	inflightRequests.set(cardId, promise);
	try {
		return await promise;
	} finally {
		inflightRequests.delete(cardId);
	}
}

async function _fetchPrice(cardId: string): Promise<PriceResult> {
	try {
		const cached = await idb.getPrice(cardId, 14400_000);
		if (cached) {
			const priceData = cached as PriceData;
			const newMap = new Map(_priceCache);
			newMap.set(cardId, priceData);
			_priceCache = newMap;
			return { data: priceData, errorReason: null };
		}
	} catch (err) {
		console.debug('[prices] IDB cache read failed:', err);
	}

	try {
		const response = await fetch(`/api/price/${cardId}`);
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			const reason = body.error || `Price lookup failed (${response.status})`;
			return { data: null, errorReason: reason };
		}

		const priceData = (await response.json()) as PriceData;

		try {
			await idb.setPrice(priceData);
		} catch (err) {
			console.debug('[prices] IDB cache write failed:', err);
		}

		const newMap = new Map(_priceCache);
		newMap.set(cardId, priceData);
		_priceCache = newMap;

		return { data: priceData, errorReason: null };
	} catch (err) {
		console.debug('[prices] Server fetch failed:', err);
		return { data: null, errorReason: 'Network error — check your connection' };
	}
}
