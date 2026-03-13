/**
 * Supabase client — optional dependency.
 *
 * Returns null when PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY
 * are not configured. All callers must handle the null case.
 *
 * For backward compatibility, `supabase` is exported as a non-null alias
 * that will error at runtime if used without configuration. Gradually
 * migrate callers to use `getSupabase()` with null checks instead.
 */

import { createBrowserClient } from '@supabase/ssr';
import { env } from '$env/dynamic/public';
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

	_supabase = createBrowserClient<Database>(url, key);
	return _supabase;
}

/**
 * Backward-compatible export. Throws if Supabase is not configured.
 * Prefer `getSupabase()` with null checks for new code.
 */
export const supabase = new Proxy({} as SupabaseClient, {
	get(_target, prop) {
		const client = getSupabase();
		if (!client) {
			throw new Error(
				`Supabase not configured. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY env vars.`
			);
		}
		return (client as unknown as Record<string | symbol, unknown>)[prop];
	}
});
