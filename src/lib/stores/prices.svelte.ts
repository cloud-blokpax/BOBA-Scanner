/**
 * Price Cache Store
 */

import { idb } from '$lib/services/idb';
import type { PriceData } from '$lib/types';

let _priceCache = $state<Map<string, PriceData>>(new Map());

export function priceCache(): Map<string, PriceData> { return _priceCache; }

const inflightRequests = new Map<string, Promise<PriceData | null>>();

export async function getPrice(cardId: string): Promise<PriceData | null> {
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

async function _fetchPrice(cardId: string): Promise<PriceData | null> {
	try {
		const cached = await idb.getPrice(cardId, 14400_000);
		if (cached) {
			const priceData = cached as PriceData;
			const newMap = new Map(_priceCache);
			newMap.set(cardId, priceData);
			_priceCache = newMap;
			return priceData;
		}
	} catch (err) {
		console.debug('[prices] IDB cache read failed:', err);
	}

	try {
		const response = await fetch(`/api/price/${cardId}`);
		if (!response.ok) return null;

		const priceData = (await response.json()) as PriceData;

		try {
			await idb.setPrice(priceData);
		} catch (err) {
			console.debug('[prices] IDB cache write failed:', err);
		}

		const newMap = new Map(_priceCache);
		newMap.set(cardId, priceData);
		_priceCache = newMap;

		return priceData;
	} catch (err) {
		console.debug('[prices] Server fetch failed:', err);
		return null;
	}
}
