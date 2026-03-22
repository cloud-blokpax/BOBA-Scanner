/**
 * GET /api/reference-image/leaderboard — Top 25 reference image contributors
 * GET /api/reference-image/leaderboard?user_id=xxx — Include user's own rank
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.supabase) return json({ leaderboard: [], user_rank: null });

	// Tables/views not in generated types — use untyped client
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = locals.supabase as any;

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

	const { count: totalContributors } = await client
		.from('card_reference_images')
		.select('contributed_by', { count: 'exact', head: true })
		.not('contributed_by', 'is', null);

	return json({
		leaderboard: leaderboard || [],
		user_rank: userRank,
		stats: {
			total_reference_images: totalImages || 0,
			total_contributors: totalContributors || 0,
			coverage_percent: totalImages ? ((totalImages / 17644) * 100).toFixed(1) : '0'
		}
	}, {
		headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' }
	});
};
