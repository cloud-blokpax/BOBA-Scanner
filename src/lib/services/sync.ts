/**
 * Cloud sync service — bidirectional collection sync.
 *
 * Uses IDB-backed tombstones (not localStorage) and batched Supabase operations.
 * Depends on collection-service.ts for data fetching (not the store directly)
 * to avoid circular dependencies.
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { getSupabase } from '$lib/services/supabase';
import { user } from '$lib/stores/auth';
import { collectionItems } from '$lib/stores/collection';
import { idb } from '$lib/services/idb';
import { fetchCollection } from '$lib/services/collection-service';

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
 * Record a card deletion for sync purposes.
 * Stored in IDB (survives browser cache clears better than localStorage).
 */
export async function recordDeletedCard(cardId: string): Promise<void> {
	try {
		await idb.addTombstone(cardId);
	} catch {
		// IDB unavailable — deletion may not sync
		console.warn('Failed to record deletion tombstone for sync');
	}
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
	const currentUser = get(user);
	const supabase = getSupabase();
	if (!currentUser || !supabase) return;

	const release = skipLock ? null : acquireSyncLock();
	if (!skipLock && !release) return; // Already locked

	try {
		const items = get(collectionItems).filter((i) => i.card_id);

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
				.from('collections_v2')
				.upsert(rows, { onConflict: 'user_id,card_id,condition' });

			if (error) {
				console.error('Sync push upsert error:', error);
			}
		}

		// Batched delete for tombstoned cards
		const tombstones = await idb.getTombstones();
		if (tombstones.length > 0) {
			const cardIds = tombstones.map((t) => t.cardId);
			const { error } = await supabase
				.from('collections_v2')
				.delete()
				.eq('user_id', currentUser.id)
				.in('card_id', cardIds);

			if (error) {
				console.error('Sync push delete error:', error);
			} else {
				// Only clear tombstones after successful remote delete
				await idb.clearTombstones();
			}
		}
	} catch (err) {
		console.error('Sync push error:', err);
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
	const currentUser = get(user);
	const supabase = getSupabase();
	if (!currentUser || !supabase) return;

	const release = acquireSyncLock();
	if (!release) return; // Already locked

	try {
		// Push first (skipLock=true since we already hold the lock)
		await pushToCloud(true);
		// Then pull remote state and update the store
		const items = await fetchCollection();
		collectionItems.set(items);
	} catch (err) {
		console.error('Full sync error:', err);
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

	// Initial sync
	fullSync();

	// Auto-sync every 5 minutes
	_autoSyncInterval = setInterval(fullSync, AUTO_SYNC_INTERVAL);

	return () => {
		if (_autoSyncInterval) clearInterval(_autoSyncInterval);
		if (_pushTimer) clearTimeout(_pushTimer);
	};
}
