/**
 * Cloud sync service — bidirectional collection sync with tombstone deletion tracking.
 *
 * Replaces legacy sync.js. Handles merging local and remote collections,
 * tombstone-based deletion, and debounced push.
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { supabase } from '$lib/services/supabase';
import { user } from '$lib/stores/auth';
import { collectionItems, loadCollection } from '$lib/stores/collection';

const TOMBSTONE_KEY = 'syncTombstones';
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const PUSH_DEBOUNCE = 2000;

let _pushTimer: ReturnType<typeof setTimeout> | null = null;
let _syncLock = false;
let _autoSyncInterval: ReturnType<typeof setInterval> | null = null;

interface Tombstone {
	cardId: string;
	deletedAt: number;
}

function loadTombstones(): Tombstone[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(TOMBSTONE_KEY);
		const tombstones: Tombstone[] = raw ? JSON.parse(raw) : [];
		// Prune expired tombstones
		const now = Date.now();
		return tombstones.filter((t) => now - t.deletedAt < TOMBSTONE_TTL);
	} catch {
		return [];
	}
}

function saveTombstones(tombstones: Tombstone[]): void {
	if (!browser) return;
	localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(tombstones));
}

/**
 * Record a card deletion for sync purposes.
 */
export function recordDeletedCard(cardId: string): void {
	const tombstones = loadTombstones();
	tombstones.push({ cardId, deletedAt: Date.now() });
	saveTombstones(tombstones);
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
 */
async function pushToCloud(): Promise<void> {
	const currentUser = get(user);
	if (!currentUser || _syncLock) return;

	_syncLock = true;
	try {
		const items = get(collectionItems);

		for (const item of items) {
			if (!item.card_id) continue;

			await supabase.from('collections_v2').upsert(
				{
					user_id: currentUser.id,
					card_id: item.card_id,
					quantity: item.quantity || 1,
					condition: item.condition || 'near_mint',
					updated_at: new Date().toISOString()
				},
				{ onConflict: 'user_id,card_id,condition' }
			);
		}

		// Apply tombstones — delete remotely
		const tombstones = loadTombstones();
		for (const tombstone of tombstones) {
			await supabase
				.from('collections_v2')
				.delete()
				.eq('user_id', currentUser.id)
				.eq('card_id', tombstone.cardId);
		}

		// Clear applied tombstones
		saveTombstones([]);
	} catch (err) {
		console.error('Sync push error:', err);
	} finally {
		_syncLock = false;
	}
}

/**
 * Force a full sync: pull remote changes and merge with local.
 */
export async function forceSync(): Promise<void> {
	const currentUser = get(user);
	if (!currentUser || _syncLock) return;

	_syncLock = true;
	try {
		// Reload collection from server
		await loadCollection();
	} catch (err) {
		console.error('Sync pull error:', err);
	} finally {
		_syncLock = false;
	}
}

/**
 * Set up automatic sync on user sign-in.
 * Returns cleanup function.
 */
export function setupAutoSync(): () => void {
	if (!browser) return () => {};

	// Initial sync
	forceSync();

	// Auto-sync every 5 minutes
	_autoSyncInterval = setInterval(forceSync, 5 * 60 * 1000);

	return () => {
		if (_autoSyncInterval) clearInterval(_autoSyncInterval);
		if (_pushTimer) clearTimeout(_pushTimer);
	};
}
