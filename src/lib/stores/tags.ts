/**
 * Tags store — card tagging system.
 *
 * Replaces legacy src/features/tags/tags.js.
 * Tags are stored per-card in localStorage and synced via the sync service.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'cardTags';

export interface TagEntry {
	cardId: string;
	tags: string[];
}

function loadTags(): Map<string, string[]> {
	if (!browser) return new Map();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return new Map();
		const entries: Record<string, string[]> = JSON.parse(raw);
		return new Map(Object.entries(entries));
	} catch (err) {
		console.debug('[tags] Tags load from storage failed:', err);
		return new Map();
	}
}

function saveTags(tags: Map<string, string[]>): void {
	if (!browser) return;
	const obj: Record<string, string[]> = {};
	for (const [key, val] of tags) {
		obj[key] = val;
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

export const cardTags = writable<Map<string, string[]>>(loadTags());

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
