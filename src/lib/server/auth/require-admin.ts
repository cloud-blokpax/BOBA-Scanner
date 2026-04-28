/**
 * Server-side admin guard. Use at the top of every admin route handler
 * (page server loads AND API endpoints).
 *
 * Verifies (a) authenticated session via safeGetSession() (which calls
 * supabase.auth.getUser() internally), (b) is_admin=true via the
 * public.is_admin() SQL function — single source of truth shared with
 * future RLS policies on admin-only tables.
 *
 * Throws 401 if no session, 403 if signed in but not admin.
 */

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { User } from '@supabase/supabase-js';
import { logEvent } from '$lib/server/diagnostics';

export interface AdminContext {
	user: User;
	authUserId: string;
	email: string;
}

export async function requireAdmin(event: RequestEvent): Promise<AdminContext> {
	const { session, user } = await event.locals.safeGetSession();

	if (!session || !user) {
		throw error(401, 'Authentication required');
	}

	if (!event.locals.supabase) {
		throw error(503, 'Database not available');
	}

	// Single source of truth: public.is_admin() SQL function.
	// Note the arg is auth_user_id (auth.users.id), NOT public.users.id.
	const { data, error: rpcError } = await event.locals.supabase.rpc('is_admin', {
		p_auth_user_id: user.id
	});

	if (rpcError) {
		console.error('[requireAdmin] is_admin RPC failed', { userId: user.id, rpcError });
		throw error(500, 'Authorization check failed');
	}

	if (data !== true) {
		// Record denials to the diagnostics stream so probe attempts are visible
		// in the admin Triage tab. Fire-and-forget — never block the request on logging.
		void logEvent({
			level: 'warn',
			event: 'admin.access_denied',
			source: 'server',
			context: {
				path: event.url.pathname,
				method: event.request.method,
				email: user.email ?? null
			},
			userId: user.id,
			requestPath: event.url.pathname
		});
		throw error(403, 'Admin access required');
	}

	return { user, authUserId: user.id, email: user.email ?? '' };
}
