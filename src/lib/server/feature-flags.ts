/**
 * Server-side feature flag reader.
 *
 * The client store in $lib/stores/feature-flags.svelte.ts evaluates
 * per-tier booleans against a logged-in user's role. Cron and other
 * server contexts have no user, so they read enabled_globally only —
 * an admin flips it on via the Features tab, and the cron picks it up
 * within CACHE_TTL_MS.
 *
 * Falls closed: if Supabase is unreachable or the row is missing, the
 * flag is treated as off. New flags should land with enabled_globally
 * defaulting to false so the closed-state matches the off-state.
 */

import { getAdminClient } from '$lib/server/supabase-admin';

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
	enabled: boolean;
	fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function isFeatureEnabledGlobally(featureKey: string): Promise<boolean> {
	const cached = cache.get(featureKey);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.enabled;
	}

	const admin = getAdminClient();
	if (!admin) return false;

	try {
		const { data, error } = await admin
			.from('feature_flags')
			.select('enabled_globally')
			.eq('feature_key', featureKey)
			.maybeSingle();

		if (error) {
			console.debug(`[feature-flags] lookup failed for ${featureKey}:`, error.message);
			return cached?.enabled ?? false;
		}

		const enabled = Boolean((data as { enabled_globally?: boolean } | null)?.enabled_globally);
		cache.set(featureKey, { enabled, fetchedAt: Date.now() });
		return enabled;
	} catch (err) {
		console.debug(
			`[feature-flags] lookup threw for ${featureKey}:`,
			err instanceof Error ? err.message : err
		);
		return cached?.enabled ?? false;
	}
}
