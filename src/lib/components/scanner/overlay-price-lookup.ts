/**
 * AR Overlay Price Lookup
 *
 * Looks up card identity and price from a perceptual hash.
 * Used by the scanner's auto-analyze loop to show price overlays
 * before the user even captures the card.
 */

export interface OverlayData {
	cardName: string;
	cardNumber: string | null;
	price: number | null;
	priceFetchedAt: string | null;
	source: 'local';
}

export async function lookupOverlayPrice(hash: string): Promise<OverlayData | null> {
	const { idb } = await import('$lib/services/idb');
	const { getCardById, loadCardDatabase } = await import('$lib/services/card-db');

	// Ensure card DB is loaded before attempting lookup — on cold start
	// the idIndex is empty and getCardById will always return undefined
	await loadCardDatabase();

	// Step 1: Local IndexedDB hash lookup
	let cardId: string | null = null;
	const source = 'local' as const;

	const localEntry = await idb.getHash(hash) as { card_id: string; confidence: number } | undefined;
	if (localEntry && !localEntry.card_id.startsWith('__unrecognized:')) {
		cardId = localEntry.card_id;
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
	// Overlay preview runs during scanning, before the parallel is known — default
	// to the Paper price. Parallel-specific prices surface on the confirmation UI.
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
					.eq('parallel', 'Paper')
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
