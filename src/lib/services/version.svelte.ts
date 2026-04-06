/**
 * App version checking service.
 *
 * Checks for app updates by fetching /version.json and comparing
 * against the stored known version.
 */

import { browser } from '$app/environment';

export const APP_VERSION = '1.1.0';

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
