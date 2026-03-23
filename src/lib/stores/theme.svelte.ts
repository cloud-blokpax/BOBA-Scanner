/**
 * Theme store — manages app theme (dark/light/custom).
 */

import { browser } from '$app/environment';

export type ThemeMode = 'dark' | 'light' | 'system';

export interface Theme {
	mode: ThemeMode;
	accentColor: string;
}

const STORAGE_KEY = 'appTheme';
const DEFAULT_THEME: Theme = { mode: 'dark', accentColor: '#3b82f6' };

function loadTheme(): Theme {
	if (!browser) return DEFAULT_THEME;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_THEME;
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_THEME;
		return { ...DEFAULT_THEME, ...parsed };
	} catch {
		return DEFAULT_THEME;
	}
}

let _theme = $state<Theme>(loadTheme());

export function theme(): Theme { return _theme; }

function applyTheme(t: Theme): void {
	if (!browser) return;
	const root = document.documentElement;
	const effectiveMode = t.mode === 'system'
		? window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
		: t.mode;
	root.dataset.theme = effectiveMode;
	root.style.setProperty('--accent-primary', t.accentColor);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

if (browser) {
	applyTheme(_theme);
	window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
		if (_theme.mode === 'system') applyTheme(_theme);
	});
}

export function setThemeMode(mode: ThemeMode): void {
	_theme = { ..._theme, mode };
	applyTheme(_theme);
}

export function setAccentColor(color: string): void {
	_theme = { ..._theme, accentColor: color };
	applyTheme(_theme);
}
