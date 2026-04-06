/**
 * Scan history store — chronological record of scan attempts.
 *
 * Persists to IndexedDB with a localStorage backup to survive IDB recovery.
 */

import { browser } from '$app/environment';
import { idb } from '$lib/services/idb';

const IDB_KEY = 'scanHistory';
const LS_BACKUP_KEY = 'scanHistory_backup';
const MAX_ENTRIES = 100;

export interface ScanHistoryEntry {
	id: string;
	timestamp: number;
	cardNumber: string | null;
	heroName: string | null;
	imageUrl: string | null;
	cardId?: string | null;
	method: 'hash_cache' | 'tesseract' | 'claude' | 'manual' | 'unknown';
	confidence: number;
	success: boolean;
	processingMs: number;
}

let _scanHistory = $state<ScanHistoryEntry[]>([]);

export function scanHistory(): ScanHistoryEntry[] { return _scanHistory; }

/** Save to localStorage as a backup (sync, immune to IDB recovery). */
function saveToLocalStorage(entries: ScanHistoryEntry[]): void {
	try {
		localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(entries));
	} catch { /* quota exceeded — ignore */ }
}

/** Load from localStorage backup. */
function loadFromLocalStorage(): ScanHistoryEntry[] | null {
	try {
		const raw = localStorage.getItem(LS_BACKUP_KEY);
		if (raw) {
			const entries = JSON.parse(raw);
			if (Array.isArray(entries) && entries.length > 0) return entries;
		}
	} catch { /* ignore */ }
	return null;
}

if (browser) {
	// localStorage is synchronous and always reflects the last successful save.
	// IDB is async and may contain stale data if a write was interrupted by
	// navigation. Therefore: localStorage is authoritative, IDB is the fast cache.
	const lsData = loadFromLocalStorage();

	idb.getMeta<ScanHistoryEntry[]>(IDB_KEY).then((idbEntries) => {
		const idbValid = Array.isArray(idbEntries) && idbEntries.length > 0;

		if (lsData) {
			// localStorage wins — it's always the most recent successful write
			_scanHistory = lsData;
			// Sync IDB to match localStorage (non-blocking)
			idb.setMeta(IDB_KEY, lsData).catch((err) => {
				console.warn('[scan-history] IDB sync from localStorage failed:', err);
			});
		} else if (idbValid) {
			// No localStorage data — use IDB and create a backup
			_scanHistory = idbEntries;
			saveToLocalStorage(idbEntries);
		}
	}).catch(() => {
		// IDB failed entirely — use localStorage if available
		if (lsData) _scanHistory = lsData;
	});

	// Migrate legacy localStorage key (one-time)
	try {
		const legacyRaw = localStorage.getItem('scanHistory');
		if (legacyRaw) {
			const legacyEntries = JSON.parse(legacyRaw);
			if (Array.isArray(legacyEntries) && legacyEntries.length > 0) {
				idb.setMeta(IDB_KEY, legacyEntries).then(() => {
					_scanHistory = legacyEntries;
					saveToLocalStorage(legacyEntries);
					localStorage.removeItem('scanHistory');
				}).catch((err) => console.warn('[scan-history] IDB migration from localStorage failed:', err));
			}
		}
	} catch (err) { console.debug('[scan-history] localStorage migration read failed:', err); }
}

function saveToIdb(entries: ScanHistoryEntry[]): void {
	if (!browser) return;
	idb.setMeta(IDB_KEY, entries).catch((err) => {
		console.debug('[scan-history] IDB save failed:', err);
	});
	saveToLocalStorage(entries);
}

export function removeFromScanHistory(id: string): void {
	const updated = _scanHistory.filter(s => s.id !== id);
	if (updated.length !== _scanHistory.length) {
		_scanHistory = updated;
		// Write localStorage synchronously FIRST (authoritative store)
		saveToLocalStorage(updated);
		// Then fire async IDB write (best-effort cache)
		idb.setMeta(IDB_KEY, updated).catch((err) => {
			console.debug('[scan-history] IDB save failed:', err);
		});
	}
}

export function addToScanHistory(entry: Omit<ScanHistoryEntry, 'id' | 'timestamp'>): void {
	const newEntry: ScanHistoryEntry = {
		...entry,
		id: crypto.randomUUID(),
		timestamp: Date.now()
	};
	const updated = [newEntry, ..._scanHistory].slice(0, MAX_ENTRIES);
	saveToIdb(updated);
	_scanHistory = updated;
}
