/**
 * Tags store — card tagging system.
 */

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
	for (const [key, val] of tags) { obj[key] = val; }
	idb.setMeta(IDB_KEY, obj).catch(err => {
		console.debug('[tags] Tags save to IDB failed:', err);
	});
}

let _cardTags = $state<Map<string, string[]>>(new Map());

export function cardTags(): Map<string, string[]> { return _cardTags; }

if (browser) {
	idb.getMeta<Record<string, string[]>>(IDB_KEY).then(raw => {
		if (raw && typeof raw === 'object') {
			_cardTags = new Map(Object.entries(raw));
		}
	}).catch(err => {
		console.debug('[tags] Tags load from IDB failed:', err);
	});
}

export function getCardTags(cardId: string): string[] {
	return _cardTags.get(cardId) || [];
}

export function setCardTags(cardId: string, tags: string[]): void {
	const newMap = new Map(_cardTags);
	if (tags.length === 0) { newMap.delete(cardId); }
	else { newMap.set(cardId, tags); }
	saveTags(newMap);
	_cardTags = newMap;
}

export function addTag(cardId: string, tag: string): void {
	const current = getCardTags(cardId);
	if (!current.includes(tag)) {
		setCardTags(cardId, [...current, tag]);
	}
}

export function removeTag(cardId: string, tag: string): void {
	const current = getCardTags(cardId);
	setCardTags(cardId, current.filter((t) => t !== tag));
}

export function getAllUniqueTags(): string[] {
	const allTags = new Set<string>();
	for (const tags of _cardTags.values()) {
		for (const tag of tags) { allTags.add(tag); }
	}
	return [...allTags].sort();
}

export function getAllTags(): Record<string, string[]> {
	const obj: Record<string, string[]> = {};
	for (const [key, val] of _cardTags) { obj[key] = val; }
	return obj;
}

export function saveAllTags(data: Record<string, string[]>): void {
	const map = new Map(Object.entries(data));
	_cardTags = map;
	saveTags(map);
}
