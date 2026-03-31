/**
 * Nav Config Store
 *
 * Manages bottom navigation item order and visibility.
 * The Scan FAB is always visible and cannot be hidden.
 * Config is persisted to localStorage (instant) and Supabase (cross-device).
 */

import { user } from './auth.svelte';
import { getSupabase } from '$lib/services/supabase';

export interface NavItem {
	id: string;
	path: string;
	icon: string;
	label: string;
	/** Additional paths that activate this nav item */
	matchPaths?: string[];
}

/** All available nav items (excluding scan FAB which is always shown) */
export const ALL_NAV_ITEMS: NavItem[] = [
	{ id: 'home', path: '/', icon: '\u{1F3E0}', label: 'Home' },
	{ id: 'collection', path: '/collection', icon: '\u{1F4DA}', label: 'Collection', matchPaths: ['/collection', '/set-completion', '/organize', '/sell', '/leaderboard', '/marketplace'] },
	{ id: 'decks', path: '/deck', icon: '\u{1F0CF}', label: 'Decks', matchPaths: ['/deck', '/tournaments', '/packs'] },
];

/** Default visible item IDs (matches current hardcoded nav) */
const DEFAULT_VISIBLE: string[] = ['home', 'collection', 'decks'];

const STORAGE_KEY = 'boba_nav_config';

interface NavConfigData {
	/** Ordered list of visible item IDs */
	visible: string[];
}

let _config = $state<NavConfigData>({ visible: [...DEFAULT_VISIBLE] });
let _loaded = $state(false);

/** Get the ordered list of visible NavItems */
export function visibleNavItems(): NavItem[] {
	return _config.visible
		.map(id => ALL_NAV_ITEMS.find(item => item.id === id))
		.filter((item): item is NavItem => !!item);
}

/** Get IDs of hidden items */
export function hiddenItemIds(): string[] {
	return ALL_NAV_ITEMS
		.map(item => item.id)
		.filter(id => !_config.visible.includes(id));
}

/** Get hidden NavItems */
export function hiddenNavItems(): NavItem[] {
	return ALL_NAV_ITEMS.filter(item => !_config.visible.includes(item.id));
}

/** Get the raw config */
export function navConfig(): NavConfigData {
	return _config;
}

export function navConfigLoaded(): boolean {
	return _loaded;
}

/** Load nav config from localStorage, then Supabase if logged in */
export async function loadNavConfig() {
	// 1. Load from localStorage (instant)
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored) as NavConfigData;
			if (Array.isArray(parsed.visible) && parsed.visible.length > 0) {
				// Filter out any stale IDs that no longer exist
				const validIds = new Set(ALL_NAV_ITEMS.map(i => i.id));
				parsed.visible = parsed.visible.filter(id => validIds.has(id));
				if (parsed.visible.length > 0) {
					_config = parsed;
				}
			}
		}
	} catch {
		// localStorage unavailable or corrupt
	}

	// 2. Load from Supabase (authoritative, overwrites localStorage)
	const currentUser = user();
	const client = getSupabase();
	if (currentUser && client) {
		try {
			const { data } = await client
				.from('users')
				.select('nav_config')
				.eq('auth_user_id', currentUser.id)
				.single();

			if (data?.nav_config && typeof data.nav_config === 'object') {
				const remote = data.nav_config as NavConfigData;
				if (Array.isArray(remote.visible) && remote.visible.length > 0) {
					const validIds = new Set(ALL_NAV_ITEMS.map(i => i.id));
					remote.visible = remote.visible.filter(id => validIds.has(id));
					if (remote.visible.length > 0) {
						_config = remote;
						saveToLocalStorage();
					}
				}
			}
		} catch {
			// Supabase unavailable, keep localStorage value
		}
	}

	_loaded = true;
}

/** Update the visible items list (order matters) */
export async function updateNavConfig(visible: string[]) {
	// Ensure at least scan-related content exists (can't hide everything)
	if (visible.length === 0) return;

	// Filter to valid IDs only
	const validIds = new Set(ALL_NAV_ITEMS.map(i => i.id));
	visible = visible.filter(id => validIds.has(id));
	if (visible.length === 0) return;

	_config = { visible };
	saveToLocalStorage();
	await saveToSupabase();
}

/** Move an item to a new position in the visible list */
export async function moveNavItem(fromIndex: number, toIndex: number) {
	const newVisible = [..._config.visible];
	const [moved] = newVisible.splice(fromIndex, 1);
	newVisible.splice(toIndex, 0, moved);
	await updateNavConfig(newVisible);
}

/** Toggle an item's visibility */
export async function toggleNavItem(id: string) {
	const idx = _config.visible.indexOf(id);
	if (idx >= 0) {
		// Hiding — must keep at least 0 custom items (scan is always there)
		const newVisible = _config.visible.filter(v => v !== id);
		await updateNavConfig(newVisible);
	} else {
		// Showing — add to end
		await updateNavConfig([..._config.visible, id]);
	}
}

/** Reset to defaults */
export async function resetNavConfig() {
	await updateNavConfig([...DEFAULT_VISIBLE]);
}

/** Reset state on sign-out */
export function clearNavConfig() {
	_config = { visible: [...DEFAULT_VISIBLE] };
	_loaded = false;
}

function saveToLocalStorage() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(_config));
	} catch {
		// localStorage unavailable
	}
}

async function saveToSupabase() {
	const currentUser = user();
	const client = getSupabase();
	if (!currentUser || !client) return;

	try {
		await client
			.from('users')
			.update({ nav_config: _config } as Record<string, unknown>)
			.eq('auth_user_id', currentUser.id);
	} catch {
		// Supabase unavailable — localStorage has the latest
	}
}
