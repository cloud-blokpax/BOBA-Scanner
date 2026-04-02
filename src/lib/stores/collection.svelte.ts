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
import { getSupabase } from '$lib/services/supabase';
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

export function getScanImageUrl(cardId: string): string | null {
	const item = _items.find(i => i.card_id === cardId);
	return item?.scan_image_url ?? null;
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
	notes: string | null = null,
	scanImageBlob?: Blob | null
): Promise<void> {
	const lockKey = `${cardId}:${condition}`;

	const existing = _addLocks.get(lockKey);
	if (existing) {
		try { await existing; } catch { /* Previous add failed — proceed */ }
	}

	const promise = (async () => {
		const item = await upsertCollectionItem(cardId, condition, notes);
		markLocallyModified(cardId);

		// Upload scan image to Supabase Storage if provided (non-blocking)
		if (scanImageBlob) {
			uploadScanImage(item.id, cardId, scanImageBlob).catch(err => {
				console.warn('[collection] Scan image upload failed (non-blocking):', err);
			});
		}

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

export async function uploadScanImage(collectionItemId: string, cardId: string, blob: Blob): Promise<string | null> {
	const client = getSupabase();
	if (!client) return null;

	const { data: { user } } = await client.auth.getUser();
	if (!user) return null;

	const filename = `${user.id}/${cardId}_${Date.now()}.jpg`;

	const { error: uploadError } = await client.storage
		.from('scan-images')
		.upload(filename, blob, {
			contentType: 'image/jpeg',
			upsert: true
		});

	if (uploadError) {
		console.error('[collection] Storage upload failed:', uploadError);
		return null;
	}

	const { data: urlData } = client.storage.from('scan-images').getPublicUrl(filename);
	if (!urlData?.publicUrl) return null;

	// scan_image_url is a new column not yet in generated Supabase types
	const { error: updateError } = await client
		.from('collections')
		.update({ scan_image_url: urlData.publicUrl } as Record<string, unknown>)
		.eq('id', collectionItemId);

	if (updateError) {
		console.error('[collection] Failed to save image URL:', updateError);
		return null;
	}

	// Update local state so the URL is immediately available for listing
	_items = _items.map(i =>
		i.id === collectionItemId ? { ...i, scan_image_url: urlData.publicUrl } : i
	);

	return urlData.publicUrl;
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
