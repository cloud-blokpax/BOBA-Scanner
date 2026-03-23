/**
 * Theme store — manages app theme (dark/light/custom).
 *
 * Replaces legacy src/ui/themes.js (23K lines -> lean reactive store).
 * Uses CSS custom properties for theming.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export type ThemeMode = 'dark' | 'light' | 'system';

export interface Theme {
	mode: ThemeMode;
	accentColor: string;
}

const STORAGE_KEY = 'appTheme';

const DEFAULT_THEME: Theme = {
	mode: 'dark',
	accentColor: '#3b82f6'
};

function loadTheme(): Theme {
	if (!browser) return DEFAULT_THEME;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_THEME;
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_THEME;
		return { ...DEFAULT_THEME, ...parsed };
	} catch (err) {
		console.debug('[theme] Theme load from storage failed:', err);
		return DEFAULT_THEME;
	}
}

export const theme = writable<Theme>(loadTheme());

/**
 * Apply theme CSS custom properties to the document.
 */
function applyTheme(t: Theme): void {
	if (!browser) return;

	const root = document.documentElement;

	// Resolve system preference
	const effectiveMode =
		t.mode === 'system'
			? window.matchMedia('(prefers-color-scheme: light)').matches
				? 'light'
				: 'dark'
			: t.mode;

	// CSS handles light/dark via [data-theme] attribute selector in index.css
	root.dataset.theme = effectiveMode;
	root.style.setProperty('--accent-primary', t.accentColor);

	localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

// Subscribe to theme changes and apply
if (browser) {
	theme.subscribe(applyTheme);

	// Listen for system theme changes
	window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
		const t = get(theme);
		if (t.mode === 'system') applyTheme(t);
	});
}

/**
 * Set the theme mode.
 */
export function setThemeMode(mode: ThemeMode): void {
	theme.update((t) => ({ ...t, mode }));
}

/**
 * Set the accent color.
 */
export function setAccentColor(color: string): void {
	theme.update((t) => ({ ...t, accentColor: color }));
}
