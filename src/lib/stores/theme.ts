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
		return raw ? { ...DEFAULT_THEME, ...JSON.parse(raw) } : DEFAULT_THEME;
	} catch {
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

	if (effectiveMode === 'light') {
		root.style.setProperty('--bg-base', '#f8fafc');
		root.style.setProperty('--bg-surface', '#ffffff');
		root.style.setProperty('--bg-elevated', '#f1f5f9');
		root.style.setProperty('--bg-hover', '#e2e8f0');
		root.style.setProperty('--text-primary', '#0f172a');
		root.style.setProperty('--text-secondary', '#475569');
		root.style.setProperty('--text-tertiary', '#94a3b8');
		root.style.setProperty('--border-color', 'rgba(15, 23, 42, 0.10)');
		root.style.setProperty('--border-strong', 'rgba(15, 23, 42, 0.20)');
	} else {
		root.style.setProperty('--bg-base', '#070b14');
		root.style.setProperty('--bg-surface', '#0d1524');
		root.style.setProperty('--bg-elevated', '#121d34');
		root.style.setProperty('--bg-hover', '#182540');
		root.style.setProperty('--text-primary', '#e2e8f0');
		root.style.setProperty('--text-secondary', '#94a3b8');
		root.style.setProperty('--text-tertiary', '#64748b');
		root.style.setProperty('--border-color', 'rgba(148, 163, 184, 0.10)');
		root.style.setProperty('--border-strong', 'rgba(148, 163, 184, 0.20)');
	}

	root.style.setProperty('--accent-primary', t.accentColor);
	root.dataset.theme = effectiveMode;

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
