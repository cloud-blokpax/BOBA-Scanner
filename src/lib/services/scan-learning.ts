/**
 * Scan learning service — OCR correction map.
 *
 * Stores confirmed OCR corrections locally to avoid repeated AI calls
 * for the same misread card numbers. Replaces legacy scan-learning.js.
 */

import { browser } from '$app/environment';
import { findCard } from '$lib/services/card-db';

const STORAGE_KEY = 'ocrCorrections';
const MAX_ENTRIES = 500;

interface CorrectionEntry {
	confirmed: string; // Confirmed card number
	source: string; // 'user' | 'ai' | 'auto'
	hits: number;
	lastUsed: number;
	created: number;
}

let _corrections: Map<string, CorrectionEntry> | null = null;

function normalize(text: string): string {
	return text.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

function loadCorrections(): Map<string, CorrectionEntry> {
	if (_corrections) return _corrections;
	if (!browser) return new Map();

	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const entries = JSON.parse(raw);
			_corrections = new Map(Object.entries(entries));
		} else {
			_corrections = new Map();
		}
	} catch (err) {
		console.debug('[scan-learning] Corrections load failed:', err);
		_corrections = new Map();
	}
	return _corrections;
}

function saveCorrections(): void {
	if (!browser || !_corrections) return;
	const obj: Record<string, CorrectionEntry> = {};
	for (const [key, val] of _corrections) {
		obj[key] = val;
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

/**
 * Check if there's a learned correction for the given OCR text.
 * Returns the corrected card number or null.
 */
export function checkCorrection(ocrText: string): string | null {
	const corrections = loadCorrections();
	const key = normalize(ocrText);
	if (!key) return null;

	const entry = corrections.get(key);
	if (!entry) return null;

	// Validate correction still exists in database
	const card = findCard(entry.confirmed);
	if (!card) {
		corrections.delete(key);
		saveCorrections();
		return null;
	}

	// Update hit count
	entry.hits++;
	entry.lastUsed = Date.now();
	saveCorrections();

	return entry.confirmed;
}

/**
 * Record a confirmed OCR correction for future lookups.
 */
export function recordCorrection(
	ocrText: string,
	confirmedCardNumber: string,
	source: string = 'auto'
): void {
	const corrections = loadCorrections();
	const key = normalize(ocrText);
	if (!key || key === normalize(confirmedCardNumber)) return;

	// Validate the confirmed card actually exists in the database
	const card = findCard(confirmedCardNumber);
	if (!card) return;

	corrections.set(key, {
		confirmed: confirmedCardNumber.toUpperCase(),
		source,
		hits: 1,
		lastUsed: Date.now(),
		created: Date.now()
	});

	// Prune if over limit (remove oldest by lastUsed)
	if (corrections.size > MAX_ENTRIES) {
		const entries = [...corrections.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
		const toRemove = entries.slice(0, corrections.size - MAX_ENTRIES);
		for (const [removeKey] of toRemove) {
			corrections.delete(removeKey);
		}
	}

	saveCorrections();
}

/**
 * Get stats about stored corrections.
 */
export function getCorrectionStats(): { total: number; totalHits: number } {
	const corrections = loadCorrections();
	let totalHits = 0;
	for (const entry of corrections.values()) {
		totalHits += entry.hits;
	}
	return { total: corrections.size, totalHits };
}
