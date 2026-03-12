/**
 * Price Cache Store
 *
 * Fetches eBay prices via server API with three-layer caching:
 *   1. IndexedDB (client, 1-hour TTL)
 *   2. Server price_cache table (1-hour TTL)
 *   3. eBay Browse API (live)
 */

import { writable } from 'svelte/store';
import { idb } from '$lib/services/idb';
import type { PriceData } from '$lib/types';

// Map of card_id → price data
export const priceCache = writable<Map<string, PriceData>>(new Map());

/**
 * Get price for a card. Checks IDB first, then server API.
 */
export async function getPrice(cardId: string): Promise<PriceData | null> {
	// Check IndexedDB cache (1-hour TTL)
	try {
		const cached = await idb.getPrice(cardId, 3600_000);
		if (cached) {
			const priceData = cached as PriceData;
			priceCache.update((map) => {
				map.set(cardId, priceData);
				return new Map(map);
			});
			return priceData;
		}
	} catch {
		// Continue to server
	}

	// Fetch from server API
	try {
		const response = await fetch(`/api/price/${cardId}`);
		if (!response.ok) return null;

		const priceData = (await response.json()) as PriceData;

		// Cache in IDB
		try {
			await idb.setPrice(priceData);
		} catch {
			// Non-critical
		}

		priceCache.update((map) => {
			map.set(cardId, priceData);
			return new Map(map);
		});

		return priceData;
	} catch {
		return null;
	}
}
