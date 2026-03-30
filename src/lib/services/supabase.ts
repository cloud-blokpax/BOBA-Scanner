/**
 * Supabase browser client.
 *
 * Returns null when PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY
 * are not configured. All callers must handle the null case via
 * getSupabase() which returns SupabaseClient | null.
 *
 * When Supabase is unconfigured, cloud features (auth, collections,
 * sync, pricing) are disabled and the app runs in offline-only mode
 * with the static card database and IndexedDB caching.
 */

import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
import { initCardImageUrl } from '$lib/utils/image-url';
import type { Database } from '$lib/types/database';

type SupabaseClient = ReturnType<typeof createBrowserClient<Database>>;

let _supabase: SupabaseClient | null = null;
let _checked = false;

/**
 * Get the Supabase client. Returns null if not configured.
 */
export function getSupabase(): SupabaseClient | null {
	if (_checked) return _supabase;
	_checked = true;

	const url = env.PUBLIC_SUPABASE_URL;
	const key = env.PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !key) {
		console.warn('Supabase not configured — cloud features disabled');
		return null;
	}

	// Initialize reference image URL fallback with Supabase URL
	initCardImageUrl(url);

	_supabase = createBrowserClient<Database>(url, key);
	return _supabase;
}

