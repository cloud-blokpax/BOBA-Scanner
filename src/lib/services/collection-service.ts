/**
 * Collection data service — handles Supabase CRUD operations.
 *
 * Separates data fetching from store state management.
 * Both the collection store and sync service depend on this,
 * breaking the previous circular dependency.
 */

import { getSupabase } from '$lib/services/supabase';
import { idb } from '$lib/services/idb';
import { forceReloadCardDatabase } from '$lib/services/card-db';
import type { CollectionItem } from '$lib/types';

/**
 * Fetch collection from Supabase with card data join.
 * Falls back to IndexedDB cache if Supabase is unconfigured or offline.
 */
export async function fetchCollection(): Promise<CollectionItem[]> {
	const supabase = getSupabase();

	if (supabase) {
		try {
			// Paginate in 1k chunks to avoid Supabase's 1,000-row default limit
			const CHUNK = 1000;
			const allData: Array<Record<string, unknown>> = [];
			let offset = 0;
			let done = false;
			while (!done) {
				const { data, error } = await supabase
					.from('collections')
					.select(`
						*,
						card:cards(*)
					`)
					.order('added_at', { ascending: false })
					.range(offset, offset + CHUNK - 1);

				if (error) throw error;
				if (!data || data.length === 0) { done = true; }
				else {
					allData.push(...data);
					offset += CHUNK;
					if (data.length < CHUNK) done = true;
				}
			}

			const items = allData.filter(
				(row: Record<string, unknown>) => {
					if (!row || typeof row.card_id !== 'string') return false;
					// Guard: if the card join returned null (e.g. card_id references
					// play_cards which has no FK from collections), skip the item.
					// Without this, components crash on item.card.hero_name access.
					if (!row.card) {
						console.warn(`[collection] Item ${row.id} has card_id=${row.card_id} but card join returned null — skipping`);
						return false;
					}
					return true;
				}
			) as unknown as CollectionItem[];

			// Cache in IndexedDB for offline use
			try {
				await idb.setCollectionItems(items);
			} catch (err) {
				console.debug('[collection] IDB cache write failed:', err);
			}

			return items;
		} catch (err) {
			console.debug('[collection] Supabase fetch failed, falling through to IDB:', err);
		}
	}

	// IndexedDB fallback (offline or Supabase unconfigured)
	try {
		const cached = await idb.getCollectionItems();
		if (cached.length > 0) {
			return cached as CollectionItem[];
		}
	} catch (err) {
		console.debug('[collection] IDB fallback read failed:', err);
	}
	return [];
}

/**
 * Upsert a card into the collection via Supabase.
 * Returns the upserted item with joined card data.
 */
export async function upsertCollectionItem(
	cardId: string,
	condition = 'near_mint',
	notes: string | null = null
): Promise<CollectionItem> {
	const supabase = getSupabase();
	if (!supabase) throw new Error('Supabase is not configured');

	const { data: { user }, error: authError } = await supabase.auth.getUser();
	if (authError || !user) throw new Error('Session expired — please sign in again');
	const userId = user.id;

	// Check if this card+condition already exists for this user
	const { data: existing, error: lookupError } = await supabase
		.from('collections')
		.select('id, quantity')
		.eq('user_id', userId)
		.eq('card_id', cardId)
		.eq('condition', condition)
		.maybeSingle();

	if (lookupError) throw new Error('Failed to check collection — please try again');

	if (existing) {
		// Increment quantity on existing entry instead of overwriting to 1
		const newQuantity = (existing.quantity || 1) + 1;
		const { data, error } = await supabase
			.from('collections')
			.update({ quantity: newQuantity, notes })
			.eq('id', existing.id)
			.select(`*, card:cards(*)`)
			.single();

		if (error) throw new Error('Failed to update quantity — please try again');
		return data as unknown as CollectionItem;
	}

	// New entry — insert with quantity 1
	const { data, error } = await supabase
		.from('collections')
		.insert({
			user_id: userId,
			card_id: cardId,
			condition,
			notes,
			quantity: 1
		})
		.select(`*, card:cards(*)`)
		.single();

	if (error) {
		// Handle race condition: another tab/device inserted between our check and insert
		if (error.code === '23505') {
			// Unique constraint violation — retry as quantity increment
			const { data: retryExisting } = await supabase
				.from('collections')
				.select('id, quantity')
				.eq('user_id', userId)
				.eq('card_id', cardId)
				.eq('condition', condition)
				.maybeSingle();

			if (retryExisting) {
				const { data: retryData, error: retryError } = await supabase
					.from('collections')
					.update({ quantity: (retryExisting.quantity || 1) + 1, notes })
					.eq('id', retryExisting.id)
					.select(`*, card:cards(*)`)
					.single();

				if (retryError) throw new Error('Failed to add card — please try again');
				return retryData as unknown as CollectionItem;
			}
		}
		// Foreign key violation — card ID doesn't exist in the cards table.
		// This happens when the local card cache has stale IDs after a DB re-seed.
		// Invalidate the IDB cache so the next load fetches fresh data.
		if (error.code === '23503') {
			try {
				// Trigger a full reload so subsequent adds work
				forceReloadCardDatabase().catch((err) => console.warn('[collection] Card DB reload failed after FK violation:', err));
			} catch (err) { console.debug('[collection] Cache invalidation wrapper failed:', err); }
			throw new Error('Card database is out of date — please refresh the page and re-scan this card');
		}
		throw new Error('Failed to add card to collection — please try again');
	}
	return data as unknown as CollectionItem;
}

/**
 * Update quantity of a collection item in Supabase.
 */
export async function updateItemQuantity(itemId: string, quantity: number): Promise<void> {
	const supabase = getSupabase();
	if (!supabase) throw new Error('Supabase is not configured');

	const { error } = await supabase
		.from('collections')
		.update({ quantity })
		.eq('id', itemId);

	if (error) throw error;
}

/**
 * Delete a collection item from Supabase.
 */
export async function deleteCollectionItem(itemId: string): Promise<void> {
	const supabase = getSupabase();
	if (!supabase) throw new Error('Supabase is not configured');

	const { error } = await supabase.from('collections').delete().eq('id', itemId);
	if (error) throw error;
}

/**
 * Record a card deletion tombstone for sync.
 */
export async function recordDeletion(cardId: string): Promise<void> {
	try {
		await idb.addTombstone(cardId);
	} catch (err) {
		console.debug('[collection-service] Deletion tombstone write failed:', err);
	}
}
