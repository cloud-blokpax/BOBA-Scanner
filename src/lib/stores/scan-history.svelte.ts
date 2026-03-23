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

