/**
 * App name helper — reads from system_settings.app_name with a 'Card Scanner'
 * fallback. Admins can revert the rebrand by editing one row:
 *
 *   INSERT INTO system_settings (key, value) VALUES ('app_name', 'BOBA Scanner')
 *     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
 *
 * Note: system_settings.value is TEXT, not JSONB. Store raw strings, not JSON.
 * The fallback is intentionally the *new* name so fresh installs show the
 * rebrand immediately even if the system_settings row was never inserted.
 */

import { getSupabase } from './supabase';

export const DEFAULT_APP_NAME = 'Card Scanner';
export const LEGACY_APP_NAME = 'BOBA Scanner';

let _cachedName: string | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

/**
 * Returns the current app display name.
 * Cached for 5 minutes to avoid hammering Supabase on every component render.
 */
export async function getAppName(): Promise<string> {
	if (_cachedName && Date.now() < _cacheExpiry) return _cachedName;
	const client = getSupabase();
	if (!client) return DEFAULT_APP_NAME;

	try {
		const { data } = await client
			.from('system_settings')
			.select('value')
			.eq('key', 'app_name')
			.maybeSingle();
		// value is TEXT (not JSONB) — supabase returns it as a plain string.
		const raw = (data?.value ?? null) as unknown;
		if (typeof raw === 'string' && raw.length > 0 && raw.length < 64) {
			_cachedName = raw;
		} else {
			_cachedName = DEFAULT_APP_NAME;
		}
	} catch {
		_cachedName = DEFAULT_APP_NAME;
	}
	_cacheExpiry = Date.now() + CACHE_TTL_MS;
	return _cachedName;
}

/** Synchronous accessor — returns the last-cached name or the default. */
export function getAppNameSync(): string {
	return _cachedName || DEFAULT_APP_NAME;
}

/** Invalidate the cache (use after an admin edit). */
export function invalidateAppNameCache(): void {
	_cachedName = null;
	_cacheExpiry = 0;
}
