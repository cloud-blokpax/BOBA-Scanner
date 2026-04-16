/**
 * AR Overlay Price Lookup
 *
 * Looks up card identity and price from a perceptual hash.
 * Used by the scanner's auto-analyze loop to show price overlays
 * before the user even captures the card.
 */

import { isFuzzyHashRpcDisabled, disableFuzzyHashRpc } from '$lib/services/recognition';

export interface OverlayData {
	cardName: string;
	cardNumber: string | null;
	price: number | null;
	priceFetchedAt: string | null;
	source: 'local' | 'community';
}

export async function lookupOverlayPrice(hash: string): Promise<OverlayData | null> {
	const { idb } = await import('$lib/services/idb');
	const { getCardById, loadCardDatabase } = await import('$lib/services/card-db');

	// Ensure card DB is loaded before attempting lookup — on cold start
	// the idIndex is empty and getCardById will always return undefined
	await loadCardDatabase();

	// Step 1: Local IndexedDB hash lookup
	let cardId: string | null = null;
	let source: 'local' | 'community' = 'local';

	const localEntry = await idb.getHash(hash) as { card_id: string; confidence: number } | undefined;
	if (localEntry && !localEntry.card_id.startsWith('__unrecognized:')) {
		cardId = localEntry.card_id;
		source = 'local';
	}

	// Step 2: Supabase shared hash lookup (only on local miss + online)
	if (!cardId && navigator.onLine) {
		try {
			const { getSupabase } = await import('$lib/services/supabase');
			const client = getSupabase();
			if (client) {
				// Exact match first
				const { data: exactMatch } = await client
					.from('hash_cache')
					.select('card_id, confidence')
					.eq('phash', hash)
					.maybeSingle();

				if (exactMatch && !(exactMatch.card_id as string).startsWith('__unrecognized:')) {
					cardId = exactMatch.card_id as string;
					source = 'community';
					await idb.setHash({
						phash: hash,
						card_id: exactMatch.card_id as string,
						confidence: exactMatch.confidence as number
					});
				}

				// Fuzzy match if exact missed
				if (!cardId && !isFuzzyHashRpcDisabled() && /^[0-9a-f]{16}$/.test(hash)) {
					const { data: fuzzyMatch, error: fuzzyErr } = await client.rpc('find_similar_hash', {
						query_hash: hash,
						max_distance: 5
					});
					if (fuzzyErr) {
						disableFuzzyHashRpc();
					}

					if (fuzzyMatch && (fuzzyMatch as Array<{ card_id: string; confidence: number; distance: number }>).length > 0) {
						const match = (fuzzyMatch as Array<{ card_id: string; confidence: number; distance: number }>)[0];
						if (!match.card_id.startsWith('__unrecognized:')) {
							cardId = match.card_id;
							source = 'community';
							const confidence = match.confidence * (1 - match.distance * 0.015);
							await idb.setHash({
								phash: hash,
								card_id: match.card_id,
								confidence
							});
						}
					}
				}
			}
		} catch (err) {
			console.debug('[ar-overlay] Supabase hash lookup failed:', err);
		}
	}

	if (!cardId) return null;
	const card = getCardById(cardId);
	if (!card) return null;

	// Step 3: Get price — local first, then Supabase
	let price: number | null = null;
	let priceFetchedAt: string | null = null;

	// Relax TTL to 7 days for overlay — stale price > no price
	const OVERLAY_PRICE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
	const localPrice = await idb.getPrice(cardId, OVERLAY_PRICE_MAX_AGE) as Record<string, unknown> | undefined;
	if (localPrice) {
		price = (localPrice.buy_now_low as number) ?? (localPrice.price_low as number) ?? (localPrice.price_mid as number) ?? null;
		priceFetchedAt = (localPrice.fetched_at as string) ?? null;
	}

	// Supabase price_cache if local miss and online.
	// Overlay preview runs during scanning, before the variant is known — default
	// to the Paper price. Variant-specific prices surface on the confirmation UI.
	if (price === null && navigator.onLine) {
		try {
			const { getSupabase } = await import('$lib/services/supabase');
			const client = getSupabase();
			if (client) {
				const { data: cachedPrice } = await client
					.from('price_cache')
					.select('price_low, price_mid, price_high, fetched_at, listings_count')
					.eq('card_id', cardId)
					.eq('source', 'ebay')
					.eq('variant', 'paper')
					.maybeSingle();

				if (cachedPrice) {
					const cp = cachedPrice as Record<string, unknown>;
					price = (cp.buy_now_low as number) ?? (cp.price_low as number) ?? (cp.price_mid as number) ?? null;
					priceFetchedAt = (cp.fetched_at as string) ?? null;
					await idb.setPrice({ card_id: cardId, ...cachedPrice });
				}
			}
		} catch (err) {
			console.debug('[ar-overlay] Supabase price lookup failed:', err);
		}
	}

	return {
		cardName: card.hero_name || card.name || 'Unknown',
		cardNumber: card.card_number || null,
		price,
		priceFetchedAt,
		source,
	};
}
