/**
 * Cloud sync service — bidirectional collection sync.
 *
 * Uses IDB-backed tombstones (not localStorage) and batched Supabase operations.
 * Depends on collection-service.ts for data fetching (not the store directly)
 * to avoid circular dependencies.
 */

import { browser } from '$app/environment';
import { getSupabase } from '$lib/services/supabase';
import { user } from '$lib/stores/auth.svelte';
import { collectionItems, setCollectionItems, getLocalModifiedAt, clearLocalModifications } from '$lib/stores/collection.svelte';
import { idb } from '$lib/services/idb';
import { fetchCollection } from '$lib/services/collection-service';
import type { CollectionItem } from '$lib/types';

const PUSH_DEBOUNCE = 2000;
const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

let _pushTimer: ReturnType<typeof setTimeout> | null = null;
let _syncLockPromise: Promise<void> | null = null;
let _autoSyncInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Promise-based lock to prevent concurrent sync operations.
 * Returns a release function; returns null if lock is already held.
 */
function acquireSyncLock(): (() => void) | null {
	if (_syncLockPromise) return null;
	let release: () => void;
	_syncLockPromise = new Promise<void>((resolve) => {
		release = () => {
			_syncLockPromise = null;
			resolve();
		};
	});
	return release!;
}

/**
 * Schedule a debounced push to cloud.
 */
export function schedulePush(): void {
	if (_pushTimer) clearTimeout(_pushTimer);
	_pushTimer = setTimeout(pushToCloud, PUSH_DEBOUNCE);
}

/**
 * Push local collection changes to Supabase.
 * Uses batched upsert (single network call) instead of per-item loops.
 */
async function pushToCloud(skipLock = false): Promise<void> {
	// Read $state variables directly — no get() needed
	const currentUser = user();
	const supabase = getSupabase();
	if (!currentUser || !supabase) return;

	const release = skipLock ? null : acquireSyncLock();
	if (!skipLock && !release) return; // Already locked

	try {
		const items = collectionItems().filter((i) => i.card_id);

		// Batched upsert — one network call for all items
		if (items.length > 0) {
			const rows = items.map((item) => ({
				user_id: currentUser.id,
				card_id: item.card_id,
				quantity: item.quantity || 1,
				condition: item.condition || 'near_mint',
				notes: item.notes || null
			}));

			const { error } = await supabase
				.from('collections')
				.upsert(rows, { onConflict: 'user_id,card_id,condition' });

			if (error) {
				console.warn('Sync push upsert error:', error);
			}
		}

		// Batched delete for tombstoned cards
		const tombstones = await idb.getTombstones();
		if (tombstones.length > 0) {
			const cardIds = tombstones.map((t) => t.cardId);
			const { error } = await supabase
				.from('collections')
				.delete()
				.eq('user_id', currentUser.id)
				.in('card_id', cardIds);

			if (error) {
				console.warn('Sync push delete error:', error);
			} else {
				// Only clear tombstones after successful remote delete
				await idb.clearTombstones();
			}
		}
	} catch (err) {
		console.warn('Sync push error:', err);
	} finally {
		if (release) release();
	}
}

/**
 * Full bidirectional sync: push local changes, then pull remote state.
 * Uses fetchCollection from collection-service (not loadCollection from store)
 * to avoid circular dependency.
 */
export async function fullSync(): Promise<void> {
	const currentUser = user();
	const supabase = getSupabase();
	if (!currentUser || !supabase) return;

	const release = acquireSyncLock();
	if (!release) return; // Already locked

	try {
		// Push first (skipLock=true since we already hold the lock)
		await pushToCloud(true);

		// Pull remote state and merge with local using timestamp-based conflict resolution
		const remoteItems = await fetchCollection();
		const localItems = collectionItems();

		const remoteMap = new Map(remoteItems.map(i => [`${i.card_id}:${i.condition}`, i]));
		const localMap = new Map(localItems.map(i => [`${i.card_id}:${i.condition}`, i]));

		// Load keys from last successful sync to detect remote deletions.
		// If a key was synced previously but is now missing from remote,
		// it was deleted on another device — don't resurrect it.
		const lastSyncedKeys = await idb.getMeta<string[]>('last-synced-remote-keys') || [];
		const lastSyncedSet = new Set(lastSyncedKeys);

		// Merge: for each card, keep the version with the later timestamp
		const allKeys = new Set([...remoteMap.keys(), ...localMap.keys()]);
		const mergedItems: CollectionItem[] = [];

		for (const key of allKeys) {
			const remote = remoteMap.get(key);
			const local = localMap.get(key);
			const localModAt = local ? getLocalModifiedAt(local.card_id) : undefined;

			if (remote && !local) {
				// Only on remote — keep it
				mergedItems.push(remote);
			} else if (local && !remote) {
				if (lastSyncedSet.has(key)) {
					// Was previously synced from server but now missing → remote deletion
					// Don't add to merged items — effectively delete locally
				} else {
					// Never synced — locally added, keep it (will be pushed next sync)
					mergedItems.push(local);
				}
			} else if (remote && local) {
				// Both exist — keep the one with the later timestamp
				const remoteTime = new Date(remote.added_at).getTime();
				const localTime = localModAt || new Date(local.added_at).getTime();
				mergedItems.push(localTime > remoteTime ? local : remote);
			}
		}

		// Save current remote keys for next sync comparison
		await idb.setMeta('last-synced-remote-keys', [...remoteMap.keys()]);

		setCollectionItems(mergedItems);
		clearLocalModifications();
	} catch (err) {
		console.warn('Full sync error:', err);
	} finally {
		release();
	}
}

/**
 * Set up automatic sync on user sign-in.
 * Returns cleanup function.
 */
export function setupAutoSync(): () => void {
	if (!browser) return () => {};

	// Initial sync (catch to avoid unhandled promise rejection)
	fullSync().catch((err) => console.warn('Initial sync failed:', err));

	// Auto-sync every 5 minutes
	_autoSyncInterval = setInterval(fullSync, AUTO_SYNC_INTERVAL);

	return () => {
		if (_autoSyncInterval) clearInterval(_autoSyncInterval);
		if (_pushTimer) clearTimeout(_pushTimer);
	};
}
