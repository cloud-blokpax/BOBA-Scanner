/**
 * App version checking service.
 *
 * Checks for app updates by fetching /version.json and comparing
 * against the stored known version.
 */

import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export const APP_VERSION = '1.1.0';

export interface UpdateInfo {
	available: boolean;
	version: string;
	notes: string;
}

export const updateAvailable = writable<UpdateInfo | null>(null);

/**
 * Check for app updates by fetching /version.json.
 */
export async function checkForUpdates(): Promise<void> {
	if (!browser) return;

	try {
		const res = await fetch(`/version.json?_=${Date.now()}`);
		if (!res.ok) return;
		const remote = await res.json();

		const stored = localStorage.getItem('knownAppVersion');
		if (stored && stored !== remote.version) {
			updateAvailable.set({
				available: true,
				version: remote.version,
				notes: remote.notes || ''
			});
		}
		localStorage.setItem('knownAppVersion', remote.version);
	} catch {
		// Non-critical — silent fail
	}
}

/**
 * Initialize version checking. Call from root layout onMount.
 * Checks after 4 seconds, then every 30 minutes.
 */
export function initVersionChecking(): () => void {
	if (!browser) return () => {};

	const initialTimeout = setTimeout(checkForUpdates, 4000);
	const interval = setInterval(checkForUpdates, 30 * 60 * 1000);

	return () => {
		clearTimeout(initialTimeout);
		clearInterval(interval);
	};
}
