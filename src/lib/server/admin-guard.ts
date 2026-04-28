/**
 * Admin authorization guard for API endpoints — legacy `(locals)` signature.
 *
 * Existing callers across `/api/admin/**` use this entry point and expect a
 * `User` back. Internally it delegates to the same `public.is_admin()` SQL
 * function used by the newer event-based guard in `./auth/require-admin.ts`,
 * keeping a single source of truth for admin checks across server code and
 * future RLS policies.
 *
 * New code should prefer `requireAdmin` from `$lib/server/auth/require-admin`,
 * which takes the full `RequestEvent` and surfaces denial telemetry.
 */

import { error } from '@sveltejs/kit';
import type { User } from '@supabase/supabase-js';

/**
 * Verify admin access and return the authenticated user.
 * Callers should use the returned user instead of calling safeGetSession() again.
 */
export async function requireAdmin(locals: App.Locals): Promise<User> {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Not authenticated');
	if (!locals.supabase) throw error(503, 'Database not available');

	const { data, error: rpcError } = await locals.supabase.rpc('is_admin', {
		p_auth_user_id: user.id
	});

	if (rpcError) {
		console.error('[requireAdmin] is_admin RPC failed', { userId: user.id, rpcError });
		throw error(500, 'Authorization check failed');
	}

	if (data !== true) throw error(403, 'Forbidden');

	return user;
}
