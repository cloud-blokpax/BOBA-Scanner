/**
 * GET /api/reference-image/leaderboard — Top 25 reference image contributors
 * GET /api/reference-image/leaderboard?user_id=xxx — Include user's own rank
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type AnySupabase = import('@supabase/supabase-js').SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.supabase) return json({ leaderboard: [], user_rank: null });

	// Tables/views not in generated types — narrowed to AnySupabase for method safety
	const client = locals.supabase as AnySupabase;

	const userId = url.searchParams.get('user_id');

	// Fetch top 25
	const { data: leaderboard } = await client
		.from('reference_image_leaderboard')
		.select('*')
		.limit(25);

	// Fetch user's own rank if requested
	let userRank = null;
	if (userId) {
		const { data: userRow } = await client
			.from('reference_image_leaderboard')
			.select('*')
			.eq('user_id', userId)
			.maybeSingle();
		userRank = userRow;
	}

	// Total stats
	const { count: totalImages } = await client
		.from('card_reference_images')
		.select('*', { count: 'exact', head: true });

	// Count distinct contributors via the leaderboard view (already grouped by user)
	const { count: totalContributors } = await client
		.from('reference_image_leaderboard')
		.select('*', { count: 'exact', head: true });

	// Get actual card count for coverage calculation instead of hardcoding
	const { count: totalCards } = await client
		.from('cards')
		.select('*', { count: 'exact', head: true });

	const cardCount = totalCards || 1; // fallback to 1 to avoid division by zero

	return json({
		leaderboard: leaderboard || [],
		user_rank: userRank,
		stats: {
			total_reference_images: totalImages || 0,
			total_contributors: totalContributors || 0,
			coverage_percent: totalImages ? ((totalImages / cardCount) * 100).toFixed(1) : '0'
		}
	}, {
		headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' }
	});
};
