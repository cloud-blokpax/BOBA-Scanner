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
	/** Legacy single-image field — kept for back-compat with pre-2.16 entries.
	 *  New code reads/writes `imageUrls` instead. */
	imageUrl: string | null;
	condition: string;
	/** Price override (null = use market price; market price falls back to 0.99) */
	priceOverride: number | null;
	addedAt: string;

	// ── Per-card CSV-field overrides (null = use computed default) ────
	titleOverride: string | null;
	descriptionOverride: string | null;
	quantityOverride: number | null;
	listingType: string | null;        // 'Buy It Now' | 'Auction' | 'Giveaway'
	shippingProfile: string | null;    // e.g. '0-1 oz', '1-3 oz'
	offerable: boolean | null;          // null = default true on BIN
	category: string | null;
	subCategory: string | null;
	skuOverride: string | null;
	cogs: number | null;

	// ── Listing photos (public https URLs only) ───────────────────────
	imageUrls: string[];                // ordered slots 1..8; index 0 = primary
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
			// Normalize legacy entries written before 2.16 added the override
			// fields. Missing fields decode as undefined; coerce to safe defaults.
			_pendingCards = savedPending.map((p) => ({
				...p,
				titleOverride: p.titleOverride ?? null,
				descriptionOverride: p.descriptionOverride ?? null,
				quantityOverride: p.quantityOverride ?? null,
				listingType: p.listingType ?? null,
				shippingProfile: p.shippingProfile ?? null,
				offerable: p.offerable ?? null,
				category: p.category ?? null,
				subCategory: p.subCategory ?? null,
				skuOverride: p.skuOverride ?? null,
				cogs: p.cogs ?? null,
				imageUrls: Array.isArray(p.imageUrls) ? p.imageUrls : []
			}));
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
		addedAt: new Date().toISOString(),
		titleOverride: null,
		descriptionOverride: null,
		quantityOverride: null,
		listingType: null,
		shippingProfile: null,
		offerable: null,
		category: null,
		subCategory: null,
		skuOverride: null,
		cogs: null,
		imageUrls: []
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
 * Update any per-card field on a pending Whatnot entry. Null is a meaningful
 * value for override fields (clears the override → falls back to computed
 * default), so callers should pass `null` rather than omitting the key when
 * resetting a field.
 */
export function updatePendingCard(
	cardId: string,
	updates: Partial<Omit<WhatnotPendingCard, 'cardId' | 'card' | 'addedAt'>>
): void {
	_pendingCards = _pendingCards.map((p) => {
		if (p.cardId !== cardId) return p;
		return { ...p, ...updates };
	});
	savePending();
}

/**
 * Append an uploaded image URL (must be public https) to the imageUrls slot
 * list. Caps at 8 — Whatnot's CSV format only supports 8 image columns.
 */
export function addImageToCard(cardId: string, imageUrl: string): void {
	if (!imageUrl.startsWith('https://')) return;
	_pendingCards = _pendingCards.map((p) => {
		if (p.cardId !== cardId) return p;
		if (p.imageUrls.includes(imageUrl)) return p;
		const next = [...p.imageUrls, imageUrl].slice(0, 8);
		return { ...p, imageUrls: next };
	});
	savePending();
}

/** Remove an image URL by index (0-based slot). */
export function removeImageFromCard(cardId: string, slotIndex: number): void {
	_pendingCards = _pendingCards.map((p) => {
		if (p.cardId !== cardId) return p;
		if (slotIndex < 0 || slotIndex >= p.imageUrls.length) return p;
		const next = p.imageUrls.filter((_, i) => i !== slotIndex);
		return { ...p, imageUrls: next };
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
