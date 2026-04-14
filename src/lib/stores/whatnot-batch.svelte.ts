/**
 * Whatnot Export Batch Store
 *
 * Manages the auto-incrementing batch number and pending card list
 * for the Whatnot scan-to-export workflow. Persisted in IndexedDB.
 */

import { browser } from '$app/environment';
import { idb } from '$lib/services/idb';
import { addTag, cardTags } from '$lib/stores/tags.svelte';
import type { Card } from '$lib/types';

const BATCH_KEY = 'whatnot-batch-number';
const PENDING_KEY = 'whatnot-pending-cards';

// ── State ───────────────────────────────────────────────────

let _batchNumber = $state<number>(1);
let _pendingCards = $state<WhatnotPendingCard[]>([]);
let _initialized = $state(false);

export interface WhatnotPendingCard {
	cardId: string;
	card: Card;
	imageUrl: string | null;
	condition: string;
	/** Price override (null = use market price) */
	priceOverride: number | null;
	addedAt: string;
}

// ── Accessors ───────────────────────────────────────────────

export function whatnotBatchNumber(): number { return _batchNumber; }
export function whatnotPendingCards(): WhatnotPendingCard[] { return _pendingCards; }
export function whatnotInitialized(): boolean { return _initialized; }
export function whatnotBatchTag(): string { return `Whatnot Export #${_batchNumber}`; }

// ── Init ────────────────────────────────────────────────────

export async function initWhatnotBatch(): Promise<void> {
	if (!browser || _initialized) return;

	try {
		const savedBatch = await idb.getMeta<number>(BATCH_KEY);
		if (typeof savedBatch === 'number' && savedBatch > 0) {
			_batchNumber = savedBatch;
		}

		const savedPending = await idb.getMeta<WhatnotPendingCard[]>(PENDING_KEY);
		if (Array.isArray(savedPending)) {
			_pendingCards = savedPending;
		}
	} catch (err) {
		console.warn('[whatnot-batch] Init failed, using defaults:', err);
	}

	_initialized = true;
}

// ── Actions ─────────────────────────────────────────────────

/**
 * Add a scanned/uploaded card to the current Whatnot export batch.
 * Tags the card with the current batch tag for tracking.
 */
export function addCardToBatch(card: Card, imageUrl: string | null, condition: string = 'Near Mint'): void {
	// Prevent duplicates in the same batch
	if (_pendingCards.some(p => p.cardId === card.id)) {
		return;
	}

	const entry: WhatnotPendingCard = {
		cardId: card.id,
		card,
		imageUrl,
		condition,
		priceOverride: null,
		addedAt: new Date().toISOString()
	};

	_pendingCards = [..._pendingCards, entry];
	savePending();

	// Tag the card with the current batch tag
	addTag(card.id, whatnotBatchTag());
}

/**
 * Remove a card from the pending batch.
 */
export function removeCardFromBatch(cardId: string): void {
	_pendingCards = _pendingCards.filter(p => p.cardId !== cardId);
	savePending();
}

/**
 * Update price or condition for a pending card.
 */
export function updatePendingCard(cardId: string, updates: { condition?: string; priceOverride?: number | null }): void {
	_pendingCards = _pendingCards.map(p => {
		if (p.cardId !== cardId) return p;
		return { ...p, ...updates };
	});
	savePending();
}

/**
 * Finalize the current batch: clear pending cards and increment batch number.
 * Called after a successful CSV export.
 */
export async function finalizeBatch(): Promise<void> {
	_batchNumber += 1;
	_pendingCards = [];

	try {
		await idb.setMeta(BATCH_KEY, _batchNumber);
		await idb.setMeta(PENDING_KEY, []);
	} catch (err) {
		console.warn('[whatnot-batch] Finalize save failed:', err);
	}
}

/**
 * Get all card IDs from previous Whatnot exports (by scanning tags).
 */
export function getPreviousExportBatches(): { batchNumber: number; cardIds: string[] }[] {
	const tags = cardTags();
	const batches = new Map<number, string[]>();

	for (const [cardId, cardTagList] of tags) {
		for (const tag of cardTagList) {
			const match = tag.match(/^Whatnot Export #(\d+)$/);
			if (match) {
				const num = parseInt(match[1], 10);
				if (!batches.has(num)) batches.set(num, []);
				batches.get(num)!.push(cardId);
			}
		}
	}

	return [...batches.entries()]
		.map(([batchNumber, cardIds]) => ({ batchNumber, cardIds }))
		.sort((a, b) => b.batchNumber - a.batchNumber);
}

// ── Persistence ─────────────────────────────────────────────

function savePending(): void {
	if (!browser) return;
	idb.setMeta(PENDING_KEY, _pendingCards).catch(err => {
		console.warn('[whatnot-batch] Pending save failed:', err);
	});
}
