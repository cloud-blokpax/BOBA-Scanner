/**
 * Scan history store — chronological record of scan attempts.
 */

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

let _scanHistory = $state<ScanHistoryEntry[]>([]);

export function scanHistory(): ScanHistoryEntry[] { return _scanHistory; }
export function scanHistoryCount(): number { return _scanHistory.length; }
export function successRate(): number {
	if (_scanHistory.length === 0) return 0;
	const successes = _scanHistory.filter((e) => e.success).length;
	return Math.round((successes / _scanHistory.length) * 100);
}

if (browser) {
	idb.getMeta<ScanHistoryEntry[]>(IDB_KEY).then((entries) => {
		if (Array.isArray(entries) && entries.length > 0) {
			_scanHistory = entries;
		}
	}).catch((err) => {
		console.debug('[scan-history] IDB load failed:', err);
	});

	try {
		const legacyRaw = localStorage.getItem('scanHistory');
		if (legacyRaw) {
			const legacyEntries = JSON.parse(legacyRaw);
			if (Array.isArray(legacyEntries) && legacyEntries.length > 0) {
				idb.setMeta(IDB_KEY, legacyEntries).then(() => {
					_scanHistory = legacyEntries;
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

export function addToScanHistory(entry: Omit<ScanHistoryEntry, 'id' | 'timestamp'>): void {
	const newEntry: ScanHistoryEntry = {
		...entry,
		id: Math.random().toString(36).slice(2, 10),
		timestamp: Date.now()
	};
	const updated = [newEntry, ..._scanHistory].slice(0, MAX_ENTRIES);
	saveToIdb(updated);
	_scanHistory = updated;
}

export function clearScanHistory(): void {
	_scanHistory = [];
	saveToIdb([]);
}

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
