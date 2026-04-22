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
import { createListingImageBlob } from '$lib/services/scan-image-utils';
import type { CollectionItem } from '$lib/types';

/** Lazy import to avoid circular dependency (sync.ts imports from this file) */
function triggerPush(): void {
	import('$lib/services/sync').then(m => m.schedulePush()).catch(() => {});
}

// ── Private mutable state ──────────────────────────────────
let _items = $state<CollectionItem[]>([]);
let _loading = $state(false);

/**
 * Game filter for the collection view.
 * 'all' = show cards from all games (unified view, default).
 * 'boba' / 'wonders' = show only that game's cards.
 */
let _gameFilter = $state<'all' | string>('all');

/**
 * Parallel filter for the collection view (Phase 2.5).
 *   'all'   = all parallels (default)
 *   'paper' = paper only
 *   'foils' = all foil parallels grouped (cf + ff + ocm + sf)
 *   'cf' | 'ff' | 'ocm' | 'sf' = specific foil type
 * Only meaningful when gameFilter is 'all' or 'wonders' — BoBA
 * collections are filtered by their per-card parallel name.
 */
let _parallelFilter = $state<'all' | 'paper' | 'foils' | 'cf' | 'ff' | 'ocm' | 'sf'>('all');

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
export function gameFilter(): 'all' | string { return _gameFilter; }
export function setGameFilter(filter: 'all' | string): void { _gameFilter = filter; }
export function parallelFilter(): 'all' | 'paper' | 'foils' | 'cf' | 'ff' | 'ocm' | 'sf' { return _parallelFilter; }
export function setParallelFilter(filter: 'all' | 'paper' | 'foils' | 'cf' | 'ff' | 'ocm' | 'sf'): void {
	_parallelFilter = filter;
}

import { normalizeParallel } from '$lib/data/parallels';
const FOIL_SET: ReadonlySet<string> = new Set(['cf', 'ff', 'ocm', 'sf']);

/** Returns items filtered by the current game AND parallel filters. */
export function collectionItems(): CollectionItem[] {
	let out = _items;
	if (_gameFilter !== 'all') {
		out = out.filter(item => (item.card?.game_id || 'boba') === _gameFilter);
	}
	if (_parallelFilter !== 'all') {
		out = out.filter(item => {
			// item.parallel is a human-readable DB name; normalize to the
			// short-code filter values for comparison.
			const code = normalizeParallel(item.parallel);
			if (_parallelFilter === 'paper') return code === 'paper';
			if (_parallelFilter === 'foils') return FOIL_SET.has(code);
			return code === _parallelFilter;
		});
	}
	return out;
}
/** Returns all items regardless of game/parallel filter (used by sync, counts, etc.) */
export function allCollectionItems(): CollectionItem[] { return _items; }
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

// ── Wonders Dragon Points total (Phase 3, Step 3.2) ──────────
// Derived per-card breakdown + collection total. Cached in a $derived so
// it only recomputes when _items changes.
import { calculateDragonPoints, type DragonPointsResult } from '$lib/games/wonders/dragon-points';

interface DragonPointsEntry {
	item: CollectionItem;
	result: DragonPointsResult;
	/** Points × quantity so duplicate copies count. */
	totalForItem: number;
}

const _dragonPointsEntries = $derived.by<DragonPointsEntry[]>(() => {
	const out: DragonPointsEntry[] = [];
	for (const item of _items) {
		if ((item.card?.game_id || 'boba') !== 'wonders') continue;
		const card = item.card;
		if (!card) continue;
		const meta = (card.metadata ?? {}) as Record<string, unknown>;
		const cardClass = typeof meta.card_class === 'string' ? meta.card_class : null;
		const result = calculateDragonPoints({
			rarity: card.rarity ?? null,
			parallel: item.parallel || 'Paper',
			year: card.year ?? null,
			card_class: cardClass,
		});
		out.push({
			item,
			result,
			totalForItem: result.points * (item.quantity || 1),
		});
	}
	return out;
});

const _dragonPointsTotal = $derived<number>(
	_dragonPointsEntries.reduce((sum, e) => sum + e.totalForItem, 0)
);

/** Total Dragon Points across the user's Wonders collection (quantity-weighted). */
export function dragonPointsTotal(): number { return _dragonPointsTotal; }

/** Per-item Dragon Points entries with breakdown. Used by /wonders/dragon-points. */
export function dragonPointsEntries(): DragonPointsEntry[] { return _dragonPointsEntries; }
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
	scanImageBlob?: Blob | null,
	gameId: string = 'boba',
	parallel: string = 'Paper'
): Promise<void> {
	// Lock key includes parallel — a Paper and CF add of the same card_id+condition
	// must be allowed to proceed in parallel because they produce different rows.
	const lockKey = `${cardId}:${condition}:${parallel}`;

	const existing = _addLocks.get(lockKey);
	if (existing) {
		try { await existing; } catch { /* Previous add failed — proceed */ }
	}

	const promise = (async () => {
		const item = await upsertCollectionItem(cardId, condition, notes, gameId, parallel);
		markLocallyModified(cardId);

		// Upload scan image to Supabase Storage if provided (non-blocking)
		if (scanImageBlob) {
			uploadScanImage(item.id, cardId, scanImageBlob).catch(err => {
				console.warn('[collection] Scan image upload failed (non-blocking):', err);
			});
		}

		// Match by (card_id, condition, parallel) — parallel makes Paper vs CF distinct.
		const idx = _items.findIndex(
			(i) => i.card_id === cardId && i.condition === condition && (i.parallel || 'Paper') === parallel
		);
		if (idx >= 0) {
			const next = [..._items];
			next[idx] = item;
			_items = next;
		} else {
			_items = [item, ..._items];
		}

		triggerPush();
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

/**
 * Upload a scan image to Supabase Storage without requiring a collection item.
 * Used by the sell flow where the card may not be in the collection.
 * Returns the public URL or null on failure.
 */
export async function uploadScanImageForListing(cardId: string, imageSource: string): Promise<string | null> {
	const client = getSupabase();
	if (!client) return null;

	const { data: { user } } = await client.auth.getUser();
	if (!user) return null;

	// Image upload open to all users — eBay requires at least 1 photo.
	// Image URL in CSV exports is Pro-gated separately in whatnot-export.ts.

	let blob: Blob;
	try {
		const response = await fetch(imageSource);
		const rawBlob = await response.blob();

		// Resize/compress to fit Supabase storage limits
		const bitmap = await createImageBitmap(rawBlob);
		const compressed = await createListingImageBlob(bitmap);
		bitmap.close();
		blob = compressed ?? rawBlob;
	} catch (err) {
		console.error('[collection] Failed to fetch/compress image source:', err);
		return null;
	}

	const filename = `${user.id}/listing_${cardId}_${Date.now()}.jpg`;

	const { error: uploadError } = await client.storage
		.from('scan-images')
		.upload(filename, blob, {
			contentType: 'image/jpeg',
			upsert: true
		});

	if (uploadError) {
		console.error('[collection] Listing image upload failed:', uploadError);
		return null;
	}

	const { data: urlData } = client.storage.from('scan-images').getPublicUrl(filename);
	return urlData?.publicUrl || null;
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
	triggerPush();
}

export async function removeFromCollection(itemId: string): Promise<void> {
	const cardId = _items.find((i) => i.id === itemId)?.card_id ?? null;
	await deleteCollectionItem(itemId);
	_items = _items.filter((i) => i.id !== itemId);
	if (cardId) {
		markLocallyModified(cardId);
		await recordDeletion(cardId);
	}
	triggerPush();
}
