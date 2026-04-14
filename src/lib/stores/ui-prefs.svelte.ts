/**
 * Persistent UI preferences backed by localStorage.
 *
 * Usage:
 *   import { uiPref } from '$lib/stores/ui-prefs.svelte';
 *   let expanded = uiPref('listing-edit-details', true);
 *   // Read:  expanded.value
 *   // Write: expanded.value = false  (auto-persists)
 */

import { browser } from '$app/environment';

const STORAGE_KEY = 'boba-ui-prefs';

let _cache: Record<string, unknown> | null = null;

function loadAll(): Record<string, unknown> {
	if (_cache) return _cache;
	if (!browser) { _cache = {}; return _cache; }
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		_cache = raw ? JSON.parse(raw) : {};
	} catch {
		_cache = {};
	}
	return _cache!;
}

function saveAll() {
	if (!browser || !_cache) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
	} catch {
		// Storage full or blocked — fail silently
	}
}

/**
 * Create a reactive UI preference that persists to localStorage.
 *
 * @param key - Unique preference key (e.g., 'listing-edit-details')
 * @param defaultValue - Default value if no saved preference exists
 * @returns Object with reactive `.value` property
 */
export function uiPref<T>(key: string, defaultValue: T): { value: T } {
	const prefs = loadAll();
	let _value = $state<T>(
		prefs[key] !== undefined ? (prefs[key] as T) : defaultValue
	);

	return {
		get value() { return _value; },
		set value(v: T) {
			_value = v;
			const all = loadAll();
			all[key] = v;
			saveAll();
		}
	};
}
