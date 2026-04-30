/**
 * App version checking service.
 *
 * Checks for app updates by fetching /version.json and comparing
 * against the stored known version.
 */

import { browser } from '$app/environment';

declare const __APP_BUILD_SHA__: string;

// Build-time short git SHA (set in vite.config.ts). The auditor pulled the
// previous semver + dated changelog out of the bundle to fingerprint
// release cadence; a 7-char SHA is opaque to that signal. Locally `dev`.
export const APP_VERSION: string =
	typeof __APP_BUILD_SHA__ === 'string' ? __APP_BUILD_SHA__ : 'dev';

export interface UpdateInfo {
	available: boolean;
	version: string;
	notes: string;
}

let _updateAvailable = $state<UpdateInfo | null>(null);

export function updateAvailable(): UpdateInfo | null {
	return _updateAvailable;
}

export function setUpdateAvailable(info: UpdateInfo | null): void {
	_updateAvailable = info;
}

/**
 * Check for app updates by fetching /version.json.
 */
export async function checkForUpdates(): Promise<void> {
	if (!browser) return;

	try {
		const res = await fetch(`/version.json?_=${Date.now()}`);
		if (!res.ok) return;
		const remote = await res.json();

		if (remote.version && remote.version !== APP_VERSION) {
			setUpdateAvailable({
				available: true,
				version: remote.version,
				notes: remote.notes || ''
			});
		}
	} catch (err) {
		console.debug('[version] Version check failed:', err);
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
