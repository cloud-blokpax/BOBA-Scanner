import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const { cardId } = params;
	if (!cardId || !/^[\w-]{1,64}$/.test(cardId)) throw error(400, 'Invalid card ID');

	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required for price history');

	// Server-side feature gate
	if (locals.supabase) {
		const { data: profile, error: profileErr } = await locals.supabase.from('users').select('is_pro, is_admin').eq('auth_user_id', user.id).single();
		if (profileErr) {
			console.error('[price/history] Profile lookup failed:', profileErr.message);
			throw error(500, 'Failed to verify account status');
		}
		const { data: override, error: overrideErr } = await locals.supabase.from('user_feature_overrides').select('enabled').eq('user_id', user.id).eq('feature_key', 'price_history').maybeSingle();
		if (overrideErr) {
			console.error('[price/history] Feature override lookup failed:', overrideErr.message);
		}
		if (override) {
			if (!override.enabled) throw error(403, 'Feature not available');
		} else if (!profile?.is_pro && !profile?.is_admin) {
			throw error(403, 'Premium feature — upgrade to access price history');
		}
	}

	if (!locals.supabase) throw error(503, 'Database not available');

	const thirtyDaysAgo = new Date();
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

	const { data, error: dbError } = await locals.supabase
		.from('price_history')
		.select('recorded_at, price_mid, price_low, price_high, listings_count')
		.eq('card_id', cardId)
		.gte('recorded_at', thirtyDaysAgo.toISOString())
		.order('recorded_at', { ascending: true });

	if (dbError) {
		console.error('[price/history] DB error:', dbError.message);
		throw error(500, 'Failed to fetch price history');
	}

	return json({
		card_id: cardId,
		history: (data || []).map((row: { recorded_at: string; price_mid: number | null; price_low: number | null; price_high: number | null; listings_count: number | null }) => ({
			date: row.recorded_at, price_mid: row.price_mid, price_low: row.price_low, price_high: row.price_high, listings_count: row.listings_count
		}))
	});
};
