/**
 * Client-side badge award helper.
 *
 * Fires badge award requests in the background. Never blocks the UI.
 * Shows a toast when a new badge is earned.
 */

import { browser } from '$app/environment';
import { showToast } from '$lib/stores/toast';

const BADGE_LABELS: Record<string, string> = {
	shutterbug: 'Shutterbug — first top reference image',
	sharp_eye: 'Sharp Eye — 10 top reference images',
	card_photographer: 'Card Photographer — 50 top reference images',
	lens_master: 'Lens Master — 100 top reference images',
	the_archivist: 'The Archivist — 500 top reference images',
	speed_demon: 'Speed Demon — 50+ points in speed challenge',
	collector: 'Collector — 100 cards in collection',
	deck_architect: 'Deck Architect — tournament-legal deck built'
};

/**
 * Attempt to award a badge. Fire-and-forget — never throws.
 * Shows a celebratory toast if the badge is newly awarded.
 */
export async function tryAwardBadge(badgeKey: string): Promise<boolean> {
	if (!browser) return false;
	try {
		const res = await fetch('/api/badges', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ badge_key: badgeKey })
		});
		if (!res.ok) return false;
		const data = await res.json();
		if (data.awarded) {
			const label = BADGE_LABELS[badgeKey] || data.badge_name;
			showToast(`Badge earned: ${label}`, 'check', 4000);
			return true;
		}
		return false;
	} catch {
		return false;
	}
}
