/**
 * Supabase service-role client for server-side operations that bypass RLS.
 *
 * Use this for:
 *   - Writing to price_cache, error_logs, listing_templates
 *   - Reading/writing ebay_seller_tokens
 *   - Admin operations on feature_flags
 *   - Any server-only table access
 *
 * NEVER import this from client-side code.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import type { Database } from '$lib/types/database';

let _adminClient: SupabaseClient<Database> | null = null;

/**
 * Get a Supabase client with service-role credentials.
 * Returns null if not configured (graceful degradation).
 */
export function getAdminClient(): SupabaseClient<Database> | null {
	if (_adminClient) return _adminClient;

	const url = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
	if (!url || !serviceKey) return null;

	_adminClient = createClient<Database>(url, serviceKey);
	return _adminClient;
}
