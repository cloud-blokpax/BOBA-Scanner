/**
 * Scan history store — chronological record of scan attempts.
 *
 * Replaces legacy scan-history.js. Stores up to 100 recent scans
 * in localStorage for offline access.
 */

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'scanHistory';
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

function loadFromStorage(): ScanHistoryEntry[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function saveToStorage(entries: ScanHistoryEntry[]): void {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export const scanHistory = writable<ScanHistoryEntry[]>(loadFromStorage());

export const scanHistoryCount = derived(scanHistory, ($history) => $history.length);
export const successRate = derived(scanHistory, ($history) => {
	if ($history.length === 0) return 0;
	const successes = $history.filter((e) => e.success).length;
	return Math.round((successes / $history.length) * 100);
});

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
		saveToStorage(updated);
		return updated;
	});
}

/**
 * Clear all scan history.
 */
export function clearScanHistory(): void {
	scanHistory.set([]);
	saveToStorage([]);
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
