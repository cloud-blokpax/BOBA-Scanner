/**
 * Collection Store
 *
 * Manages user's card collection with:
 *   - Supabase persistence (RLS enforced)
 *   - IndexedDB offline cache
 *   - Reactive Svelte store
 */

import { writable, derived } from 'svelte/store';
import { supabase } from '$lib/services/supabase';
import { idb } from '$lib/services/idb';
import type { CollectionItem, Card } from '$lib/types';

export const collectionItems = writable<CollectionItem[]>([]);
export const collectionLoading = writable(false);

export const collectionCount = derived(collectionItems, ($items) =>
	$items.reduce((sum, item) => sum + item.quantity, 0)
);

export const uniqueCardCount = derived(collectionItems, ($items) => $items.length);

/**
 * Load collection from Supabase (with card data join).
 * Falls back to IndexedDB cache if offline.
 */
export async function loadCollection(): Promise<void> {
	collectionLoading.set(true);

	try {
		const { data, error } = await supabase
			.from('collections_v2')
			.select(`
				*,
				card:cards(*)
			`)
			.order('added_at', { ascending: false });

		if (error) throw error;

		const items = (data || []) as CollectionItem[];
		collectionItems.set(items);

		// Cache in IndexedDB for offline use
		try {
			await idb.setCollectionItems(items);
		} catch {
			// Non-critical
		}
	} catch {
		// Try IndexedDB fallback
		try {
			const cached = await idb.getCollectionItems();
			if (cached.length > 0) {
				collectionItems.set(cached as CollectionItem[]);
			}
		} catch {
			// Both sources failed
		}
	} finally {
		collectionLoading.set(false);
	}
}

/**
 * Add a card to the collection.
 */
export async function addToCollection(
	cardId: string,
	condition = 'near_mint',
	notes: string | null = null
): Promise<void> {
	const { data, error } = await supabase
		.from('collections_v2')
		.upsert(
			{
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

	const item = (data as unknown) as CollectionItem;
	collectionItems.update((items) => {
		const existing = items.findIndex(
			(i) => i.card_id === cardId && i.condition === condition
		);
		if (existing >= 0) {
			items[existing] = item;
		} else {
			items.unshift(item);
		}
		return items;
	});
}

/**
 * Update quantity of a collection item.
 */
export async function updateQuantity(itemId: string, quantity: number): Promise<void> {
	if (quantity <= 0) {
		await removeFromCollection(itemId);
		return;
	}

	const { error } = await supabase
		.from('collections_v2')
		.update({ quantity } as never)
		.eq('id' as never, itemId);

	if (error) throw error;

	collectionItems.update((items) =>
		items.map((i) => (i.id === itemId ? { ...i, quantity } : i))
	);
}

/**
 * Remove a card from the collection.
 */
export async function removeFromCollection(itemId: string): Promise<void> {
	const { error } = await supabase.from('collections_v2').delete().eq('id' as never, itemId);

	if (error) throw error;

	collectionItems.update((items) => items.filter((i) => i.id !== itemId));
}
