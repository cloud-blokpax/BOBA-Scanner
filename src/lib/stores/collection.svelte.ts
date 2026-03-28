/**
 * Collection Store
 *
 * Manages user's card collection with Svelte 5 reactive state.
 * Delegates DB operations to collection-service.ts.
 */

import {
	fetchCollection,
	upsertCollectionItem,
	updateItemQuantity,
	deleteCollectionItem,
	recordDeletion
} from '$lib/services/collection-service';
import type { CollectionItem } from '$lib/types';

// ── Private mutable state ──────────────────────────────────
let _items = $state<CollectionItem[]>([]);
let _loading = $state(false);

// Track when items were last locally modified for sync conflict resolution
const _localModifiedAt = new Map<string, number>();

export function markLocallyModified(cardId: string): void {
	_localModifiedAt.set(cardId, Date.now());
}

export function getLocalModifiedAt(cardId: string): number | undefined {
	return _localModifiedAt.get(cardId);
}

export function clearLocalModifications(): void {
	_localModifiedAt.clear();
}

// ── Public reactive accessors ──────────────────────────────────
export function collectionItems(): CollectionItem[] { return _items; }
export function collectionLoading(): boolean { return _loading; }
export function collectionCount(): number {
	return _items.reduce((sum, item) => sum + (item.quantity || 1), 0);
}
export function uniqueCardCount(): number { return _items.length; }
const _ownedCounts = $derived.by(() => {
	const map = new Map<string, number>();
	for (const item of _items) {
		map.set(item.card_id, (map.get(item.card_id) || 0) + (item.quantity || 1));
	}
	return map;
});
export function ownedCardCounts(): Map<string, number> { return _ownedCounts; }
export function collectionSets(): string[] {
	const sets = new Set<string>();
	for (const item of _items) {
		if (item.card?.set_code) sets.add(item.card.set_code);
	}
	return [...sets].sort();
}
export function collectionRarities(): string[] {
	const rarities = new Set<string>();
	for (const item of _items) {
		if (item.card?.rarity) rarities.add(item.card.rarity);
	}
	return [...rarities].sort();
}
export function collectionWeaponTypes(): string[] {
	const types = new Set<string>();
	for (const item of _items) {
		if (item.card?.weapon_type) types.add(item.card.weapon_type);
	}
	return [...types].sort();
}

/**
 * Set collection items directly (used by sync service).
 */
export function setCollectionItems(items: CollectionItem[]): void {
	_items = items;
}

export async function loadCollection(): Promise<void> {
	_loading = true;
	try {
		const items = await fetchCollection();
		_items = items;
	} finally {
		_loading = false;
	}
}

const _addLocks = new Map<string, Promise<void>>();

export async function addToCollection(
	cardId: string,
	condition = 'near_mint',
	notes: string | null = null
): Promise<void> {
	const lockKey = `${cardId}:${condition}`;

	const existing = _addLocks.get(lockKey);
	if (existing) {
		try { await existing; } catch { /* Previous add failed — proceed */ }
	}

	const promise = (async () => {
		const item = await upsertCollectionItem(cardId, condition, notes);
		markLocallyModified(cardId);
		const idx = _items.findIndex(
			(i) => i.card_id === cardId && i.condition === condition
		);
		if (idx >= 0) {
			const next = [..._items];
			next[idx] = item;
			_items = next;
		} else {
			_items = [item, ..._items];
		}
	})();

	_addLocks.set(lockKey, promise);
	try {
		await promise;
	} finally {
		if (_addLocks.get(lockKey) === promise) {
			_addLocks.delete(lockKey);
		}
	}
}

export async function updateQuantity(itemId: string, quantity: number): Promise<void> {
	if (quantity <= 0) {
		await removeFromCollection(itemId);
		return;
	}
	await updateItemQuantity(itemId, quantity);
	const cardId = _items.find((i) => i.id === itemId)?.card_id;
	if (cardId) markLocallyModified(cardId);
	_items = _items.map((i) => i.id === itemId ? { ...i, quantity } : i);
}

export async function removeFromCollection(itemId: string): Promise<void> {
	const cardId = _items.find((i) => i.id === itemId)?.card_id ?? null;
	await deleteCollectionItem(itemId);
	_items = _items.filter((i) => i.id !== itemId);
	if (cardId) {
		markLocallyModified(cardId);
		await recordDeletion(cardId);
	}
}
