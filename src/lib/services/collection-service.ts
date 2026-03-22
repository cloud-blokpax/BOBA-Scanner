/**
 * Collection data service — handles Supabase CRUD operations.
 *
 * Separates data fetching from store state management.
 * Both the collection store and sync service depend on this,
 * breaking the previous circular dependency.
 */

import { getSupabase } from '$lib/services/supabase';
import { idb } from '$lib/services/idb';
import type { CollectionItem } from '$lib/types';

/**
 * Fetch collection from Supabase with card data join.
 * Falls back to IndexedDB cache if Supabase is unconfigured or offline.
 */
export async function fetchCollection(): Promise<CollectionItem[]> {
	const supabase = getSupabase();

	if (supabase) {
		try {
			const { data, error } = await supabase
				.from('collections_v2')
				.select(`
					*,
					card:cards(*)
				`)
				.order('added_at', { ascending: false });

			if (error) throw error;

			const items = (data || []).filter(
				(row: Record<string, unknown>) => row && typeof row.card_id === 'string'
			) as CollectionItem[];

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

	const { data, error } = await supabase
		.from('collections_v2')
		.upsert(
			{
				user_id: userId,
				card_id: cardId,
				condition,
				notes,
				quantity: 1
			},
			{ onConflict: 'user_id,card_id,condition' }
		)
		.select(`*, card:cards(*)`)
		.single();

	if (error) throw error;

	return data as unknown as CollectionItem;
}

/**
 * Update quantity of a collection item in Supabase.
 */
export async function updateItemQuantity(itemId: string, quantity: number): Promise<void> {
	const supabase = getSupabase();
	if (!supabase) throw new Error('Supabase is not configured');

	const { error } = await supabase
		.from('collections_v2')
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

	const { error } = await supabase.from('collections_v2').delete().eq('id', itemId);
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
