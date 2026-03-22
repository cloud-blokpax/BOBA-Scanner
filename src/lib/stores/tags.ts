/**
 * Tags store — card tagging system.
 *
 * Replaces legacy src/features/tags/tags.js.
 * Tags are stored per-card in localStorage and synced via the sync service.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { idb } from '$lib/services/idb';

const IDB_KEY = 'cardTags';

export interface TagEntry {
	cardId: string;
	tags: string[];
}

function saveTags(tags: Map<string, string[]>): void {
	if (!browser) return;
	const obj: Record<string, string[]> = {};
	for (const [key, val] of tags) {
		obj[key] = val;
	}
	idb.setMeta(IDB_KEY, obj).catch(err => {
		console.debug('[tags] Tags save to IDB failed:', err);
	});
}

export const cardTags = writable<Map<string, string[]>>(new Map());

// Load tags from IDB asynchronously on startup
if (browser) {
	idb.getMeta<Record<string, string[]>>(IDB_KEY).then(raw => {
		if (raw && typeof raw === 'object') {
			cardTags.set(new Map(Object.entries(raw)));
		}
	}).catch(err => {
		console.debug('[tags] Tags load from IDB failed:', err);
	});
}

/**
 * Get tags for a specific card.
 */
export function getCardTags(cardId: string): string[] {
	return get(cardTags).get(cardId) || [];
}

/**
 * Set tags for a card.
 */
export function setCardTags(cardId: string, tags: string[]): void {
	cardTags.update((map) => {
		if (tags.length === 0) {
			map.delete(cardId);
		} else {
			map.set(cardId, tags);
		}
		saveTags(map);
		return new Map(map);
	});
}

/**
 * Add a tag to a card.
 */
export function addTag(cardId: string, tag: string): void {
	const current = getCardTags(cardId);
	if (!current.includes(tag)) {
		setCardTags(cardId, [...current, tag]);
	}
}

/**
 * Remove a tag from a card.
 */
export function removeTag(cardId: string, tag: string): void {
	const current = getCardTags(cardId);
	setCardTags(cardId, current.filter((t) => t !== tag));
}

/**
 * Get all unique tags across all cards.
 */
export function getAllUniqueTags(): string[] {
	const allTags = new Set<string>();
	for (const tags of get(cardTags).values()) {
		for (const tag of tags) {
			allTags.add(tag);
		}
	}
	return [...allTags].sort();
}

/**
 * Get all tag data for sync.
 */
export function getAllTags(): Record<string, string[]> {
	const obj: Record<string, string[]> = {};
	for (const [key, val] of get(cardTags)) {
		obj[key] = val;
	}
	return obj;
}

/**
 * Restore tags from sync data.
 */
export function saveAllTags(data: Record<string, string[]>): void {
	const map = new Map(Object.entries(data));
	cardTags.set(map);
	saveTags(map);
}
