import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');
	if (!locals.supabase) throw error(503, 'Database not available');

	const { data: profile } = await locals.supabase
		.from('users')
		.select('is_pro, is_admin')
		.eq('auth_user_id', user.id)
		.single();

	if (profile?.is_pro || profile?.is_admin) {
		return json({ weekly_count: 0, weekly_limit: null, is_pro: true });
	}

	const { data: countResult, error: countErr } = await locals.supabase
		.rpc('get_weekly_listing_count', { p_user_id: user.id });

	if (countErr) {
		console.error('[listings/weekly-count] Count failed:', countErr.message);
		throw error(500, 'Failed to get listing count');
	}

	const weeklyCount = typeof countResult === 'number' ? countResult : 0;

	return json({
		weekly_count: weeklyCount,
		weekly_limit: 3,
		remaining: Math.max(0, 3 - weeklyCount),
		is_pro: false
	});
};
