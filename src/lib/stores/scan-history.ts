/**
 * Scan history store — chronological record of scan attempts.
 *
 * Stores up to 100 recent scans in IndexedDB for offline access.
 * Migrates from localStorage on first load.
 */

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';
import { idb } from '$lib/services/idb';

const IDB_KEY = 'scanHistory';
const MAX_ENTRIES = 100;

export interface ScanHistoryEntry {
	id: string;
	timestamp: number;
	cardNumber: string | null;
	heroName: string | null;
	method: 'hash_cache' | 'tesseract' | 'claude' | 'manual' | 'unknown';
	confidence: number;
	success: boolean;
	processingMs: number;
}

export const scanHistory = writable<ScanHistoryEntry[]>([]);

export const scanHistoryCount = derived(scanHistory, ($history) => $history.length);
export const successRate = derived(scanHistory, ($history) => {
	if ($history.length === 0) return 0;
	const successes = $history.filter((e) => e.success).length;
	return Math.round((successes / $history.length) * 100);
});

// Load from IDB asynchronously on startup (non-blocking)
if (browser) {
	idb.getMeta<ScanHistoryEntry[]>(IDB_KEY).then((entries) => {
		if (Array.isArray(entries) && entries.length > 0) {
			scanHistory.set(entries);
		}
	}).catch((err) => {
		console.debug('[scan-history] IDB load failed:', err);
	});

	// Migrate from localStorage if present (one-time bridge)
	try {
		const legacyRaw = localStorage.getItem('scanHistory');
		if (legacyRaw) {
			const legacyEntries = JSON.parse(legacyRaw);
			if (Array.isArray(legacyEntries) && legacyEntries.length > 0) {
				idb.setMeta(IDB_KEY, legacyEntries).then(() => {
					scanHistory.set(legacyEntries);
					localStorage.removeItem('scanHistory');
				}).catch(() => {});
			}
		}
	} catch { /* ignore */ }
}

function saveToIdb(entries: ScanHistoryEntry[]): void {
	if (!browser) return;
	idb.setMeta(IDB_KEY, entries).catch((err) => {
		console.debug('[scan-history] IDB save failed:', err);
	});
}

/**
 * Add a scan to history.
 */
export function addToScanHistory(entry: Omit<ScanHistoryEntry, 'id' | 'timestamp'>): void {
	scanHistory.update((history) => {
		const newEntry: ScanHistoryEntry = {
			...entry,
			id: Math.random().toString(36).slice(2, 10),
			timestamp: Date.now()
		};
		const updated = [newEntry, ...history].slice(0, MAX_ENTRIES);
		saveToIdb(updated);
		return updated;
	});
}

/**
 * Clear all scan history.
 */
export function clearScanHistory(): void {
	scanHistory.set([]);
	saveToIdb([]);
}

/**
 * Format time ago for display.
 */
export function timeAgo(timestamp: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
