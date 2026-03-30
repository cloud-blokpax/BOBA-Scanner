/**
 * Client-side behavioral tracking for persona adaptation.
 *
 * Tracks user actions in IndexedDB and computes persona signal scores
 * with a 21-day half-life exponential decay. The persona store can
 * periodically read these scores to suggest persona weight adjustments.
 *
 * Events are lightweight: { action, timestamp }. No PII is stored.
 */

import { browser } from '$app/environment';
import type { PersonaId, PersonaWeights } from '$stores/persona.svelte';

// ── Types ────────────────────────────────────────────────────

export interface BehaviorEvent {
	id: string;
	action: BehaviorAction;
	timestamp: number;
}

export type BehaviorAction =
	| 'scan_card'
	| 'add_to_collection'
	| 'view_collection'
	| 'view_set_completion'
	| 'create_deck'
	| 'edit_deck'
	| 'view_deck'
	| 'use_architect'
	| 'view_sell'
	| 'export_collection'
	| 'check_price'
	| 'view_tournament'
	| 'enter_tournament'
	| 'lookup_tournament'
	| 'view_grader'
	| 'open_pack';

/** Maps each action to persona signal weights */
const ACTION_PERSONA_MAP: Record<BehaviorAction, Partial<PersonaWeights>> = {
	scan_card:           { collector: 0.6, deck_builder: 0.2, seller: 0.2 },
	add_to_collection:   { collector: 1.0 },
	view_collection:     { collector: 0.8 },
	view_set_completion: { collector: 1.0 },
	create_deck:         { deck_builder: 1.0 },
	edit_deck:           { deck_builder: 0.8, tournament: 0.2 },
	view_deck:           { deck_builder: 0.6, tournament: 0.3 },
	use_architect:       { deck_builder: 1.0 },
	view_sell:           { seller: 1.0 },
	export_collection:   { seller: 0.7, collector: 0.3 },
	check_price:         { seller: 0.8, collector: 0.2 },
	view_tournament:     { tournament: 0.8 },
	enter_tournament:    { tournament: 1.0 },
	lookup_tournament:   { tournament: 0.9 },
	view_grader:         { seller: 0.5, collector: 0.5 },
	open_pack:           { collector: 0.5 }
};

// ── Constants ────────────────────────────────────────────────

const DB_NAME = 'boba-behavior';
const DB_VERSION = 1;
const STORE_NAME = 'events';
const HALF_LIFE_DAYS = 21;
const HALF_LIFE_MS = HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
/** Prune events older than 90 days */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** Max events to keep (prevents unbounded growth) */
const MAX_EVENTS = 5000;

// ── IndexedDB ────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openBehaviorDB(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				store.createIndex('timestamp', 'timestamp');
				store.createIndex('action', 'action');
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => {
			dbPromise = null;
			reject(request.error);
		};
	});

	return dbPromise;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Record a behavioral event. Fire-and-forget — errors are silently ignored.
 */
export function trackBehavior(action: BehaviorAction): void {
	if (!browser) return;

	const event: BehaviorEvent = {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		action,
		timestamp: Date.now()
	};

	openBehaviorDB()
		.then((db) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).put(event);
		})
		.catch((err) => {
			console.debug('[behavior-tracker] Failed to record event:', action, err);
		});
}

/**
 * Compute persona scores from behavioral history using 21-day half-life decay.
 *
 * Each event contributes to persona scores based on ACTION_PERSONA_MAP,
 * weighted by an exponential decay factor: weight * 2^(-age / halfLife).
 *
 * Returns normalized scores (0-1) for each persona.
 */
export async function computeBehaviorScores(): Promise<PersonaWeights> {
	if (!browser) {
		return { collector: 0, deck_builder: 0, seller: 0, tournament: 0 };
	}

	const scores: PersonaWeights = { collector: 0, deck_builder: 0, seller: 0, tournament: 0 };
	const now = Date.now();

	try {
		const db = await openBehaviorDB();
		const events = await new Promise<BehaviorEvent[]>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const store = tx.objectStore(STORE_NAME);
			const index = store.index('timestamp');

			// Only read events from the last 90 days
			const cutoff = now - MAX_AGE_MS;
			const range = IDBKeyRange.lowerBound(cutoff);
			const req = index.getAll(range);

			req.onsuccess = () => resolve(req.result as BehaviorEvent[]);
			req.onerror = () => reject(req.error);
		});

		for (const event of events) {
			const ageMs = now - event.timestamp;
			const decayFactor = Math.pow(2, -ageMs / HALF_LIFE_MS);
			const personaSignals = ACTION_PERSONA_MAP[event.action];

			if (personaSignals) {
				for (const [persona, weight] of Object.entries(personaSignals)) {
					scores[persona as PersonaId] += (weight as number) * decayFactor;
				}
			}
		}

		// Normalize to 0-1 range
		const maxScore = Math.max(...Object.values(scores), 0.001);
		for (const key of Object.keys(scores) as PersonaId[]) {
			scores[key] = Math.round((scores[key] / maxScore) * 100) / 100;
		}
	} catch {
		// Return zeros on error — behavioral scoring is non-critical
	}

	return scores;
}

/**
 * Get suggested persona weights based on behavioral data.
 * Returns null if insufficient data (fewer than 5 events).
 */
export async function getSuggestedPersona(): Promise<PersonaWeights | null> {
	if (!browser) return null;

	try {
		const db = await openBehaviorDB();
		const count = await new Promise<number>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly');
			const req = tx.objectStore(STORE_NAME).count();
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});

		if (count < 5) return null;

		return computeBehaviorScores();
	} catch {
		return null;
	}
}

/**
 * Prune old events (>90 days) and enforce max event count.
 * Call periodically (e.g., on app startup).
 */
export async function pruneBehaviorEvents(): Promise<void> {
	if (!browser) return;

	try {
		const db = await openBehaviorDB();
		const cutoff = Date.now() - MAX_AGE_MS;

		// Delete old events
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		const index = store.index('timestamp');
		const range = IDBKeyRange.upperBound(cutoff);

		const req = index.openCursor(range);
		req.onsuccess = () => {
			const cursor = req.result;
			if (cursor) {
				cursor.delete();
				cursor.continue();
			}
		};

		await new Promise<void>((resolve) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => resolve();
		});

		// Enforce max count — keep newest MAX_EVENTS
		const countTx = db.transaction(STORE_NAME, 'readonly');
		const countReq = countTx.objectStore(STORE_NAME).count();
		const total = await new Promise<number>((resolve) => {
			countReq.onsuccess = () => resolve(countReq.result);
			countReq.onerror = () => resolve(0);
		});

		if (total > MAX_EVENTS) {
			const deleteTx = db.transaction(STORE_NAME, 'readwrite');
			const deleteStore = deleteTx.objectStore(STORE_NAME);
			const deleteIndex = deleteStore.index('timestamp');
			const deleteReq = deleteIndex.openCursor();
			let deleted = 0;
			const toDelete = total - MAX_EVENTS;

			deleteReq.onsuccess = () => {
				const cursor = deleteReq.result;
				if (cursor && deleted < toDelete) {
					cursor.delete();
					deleted++;
					cursor.continue();
				}
			};
		}
	} catch {
		// Silent failure
	}
}
