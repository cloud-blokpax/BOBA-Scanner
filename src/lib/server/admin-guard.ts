/**
 * Admin authorization guard for API endpoints.
 *
 * Independently verifies admin status from the database rather than
 * trusting client-side session data. Use this in any API endpoint
 * that performs admin-only mutations.
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

	const { data: profile } = await locals.supabase
		.from('users')
		.select('is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	// SECURITY: Only trust the database profile and app_metadata (server-only).
	// Never trust user_metadata — it is editable by the user via auth.updateUser().
	const isAdmin = profile?.is_admin === true
		|| user.app_metadata?.is_admin === true;

	if (!isAdmin) throw error(403, 'Forbidden');

	return user;
}
