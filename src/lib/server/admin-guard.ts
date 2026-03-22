/**
 * Admin authorization guard for API endpoints.
 *
 * Independently verifies admin status from the database rather than
 * trusting client-side session data. Use this in any API endpoint
 * that performs admin-only mutations.
 */

import { error } from '@sveltejs/kit';

export async function requireAdmin(locals: App.Locals): Promise<void> {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Not authenticated');
	if (!locals.supabase) throw error(503, 'Database not available');

	const { data: profile } = await locals.supabase
		.from('users')
		.select('is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	if (!profile?.is_admin) throw error(403, 'Admin access required');
}
