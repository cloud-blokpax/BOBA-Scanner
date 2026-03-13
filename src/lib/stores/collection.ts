/**
 * Collection Store
 *
 * Manages user's card collection with:
 *   - Supabase persistence (RLS enforced)
 *   - IndexedDB offline cache
 *   - Reactive Svelte store
 */

import { writable, derived, get } from 'svelte/store';
import { supabase } from '$lib/services/supabase';
import { idb } from '$lib/services/idb';
import { recordDeletedCard } from '$lib/services/sync';
import type { CollectionItem, Card } from '$lib/types';

export const collectionItems = writable<CollectionItem[]>([]);
export const collectionLoading = writable(false);

export const collectionCount = derived(collectionItems, ($items) =>
	$items.reduce((sum, item) => sum + item.quantity, 0)
);

export const uniqueCardCount = derived(collectionItems, ($items) => $items.length);

/**
 * Get the total quantity of a specific card across all conditions.
 */
export function getOwnedCount(cardId: string): number {
	const items = get(collectionItems);
	return items
		.filter((i) => i.card_id === cardId)
		.reduce((sum, i) => sum + i.quantity, 0);
}

/**
 * Derived store mapping card_id → total owned quantity for fast lookups.
 */
export const ownedCardCounts = derived(collectionItems, ($items) => {
	const map = new Map<string, number>();
	for (const item of $items) {
		map.set(item.card_id, (map.get(item.card_id) || 0) + item.quantity);
	}
	return map;
});

/**
 * Get unique set codes from the collection.
 */
export const collectionSets = derived(collectionItems, ($items) => {
	const sets = new Set<string>();
	for (const item of $items) {
		if (item.card?.set_code) sets.add(item.card.set_code);
	}
	return [...sets].sort();
});

/**
 * Get unique rarities from the collection.
 */
export const collectionRarities = derived(collectionItems, ($items) => {
	const rarities = new Set<string>();
	for (const item of $items) {
		if (item.card?.rarity) rarities.add(item.card.rarity);
	}
	return [...rarities].sort();
});

/**
 * Get unique weapon types from the collection.
 */
export const collectionWeaponTypes = derived(collectionItems, ($items) => {
	const types = new Set<string>();
	for (const item of $items) {
		if (item.card?.weapon_type) types.add(item.card.weapon_type);
	}
	return [...types].sort();
});

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
	// Get user_id from the current session (required for upsert conflict resolution)
	const { data: sessionData } = await supabase.auth.getSession();
	const userId = sessionData?.session?.user?.id;
	if (!userId) throw new Error('Not authenticated');

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
		.update({ quantity })
		.eq('id', itemId);

	if (error) throw error;

	collectionItems.update((items) =>
		items.map((i) => (i.id === itemId ? { ...i, quantity } : i))
	);
}

/**
 * Remove a card from the collection.
 */
export async function removeFromCollection(itemId: string): Promise<void> {
	// Capture card_id before removing from store
	const items = get(collectionItems);
	const cardId = items.find((i) => i.id === itemId)?.card_id ?? null;

	const { error } = await supabase.from('collections_v2').delete().eq('id', itemId);

	if (error) throw error;

	collectionItems.update((items) => items.filter((i) => i.id !== itemId));

	// Record deletion for sync
	if (cardId) {
		await recordDeletedCard(cardId);
	}
}
