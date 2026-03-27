import { json, error } from '@sveltejs/kit';
import { parseJsonBody, requireString } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

async function requireOrganizerOrAdmin(locals: App.Locals): Promise<{ id: string }> {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Not authenticated');
	if (!locals.supabase) throw error(503, 'Database not available');

	const { data: profile } = await locals.supabase
		.from('users')
		.select('is_organizer, is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	if (!profile?.is_organizer && !profile?.is_admin) {
		throw error(403, 'Organizer or admin access required');
	}

	return user;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireOrganizerOrAdmin(locals);
	const supabase = locals.supabase!;

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, {
			status: 429,
			headers: {
				'X-RateLimit-Limit': String(rateLimit.limit),
				'X-RateLimit-Remaining': String(rateLimit.remaining),
				'X-RateLimit-Reset': String(rateLimit.reset)
			}
		});
	}

	const body = await parseJsonBody(request);

	const tournamentId = requireString(body.tournament_id, 'tournament_id');

	const results = body.results as Array<{
		player_name: string;
		final_standing: number;
		placement_label?: string;
		match_wins?: number;
		match_losses?: number;
		match_draws?: number;
		submission_id?: string;
		player_user_id?: string;
	}>;

	if (!Array.isArray(results) || results.length === 0) {
		throw error(400, 'results array is required');
	}
	if (results.length > 500) {
		throw error(400, 'Too many results (max 500)');
	}
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (typeof r.player_name !== 'string' || !r.player_name.trim()) {
			throw error(400, `results[${i}].player_name is required`);
		}
		if (typeof r.final_standing !== 'number' || r.final_standing < 1) {
			throw error(400, `results[${i}].final_standing must be a positive number`);
		}
	}

	// Verify tournament exists and user has access
	const { data: tournament } = await supabase
		.from('tournaments')
		.select('id, creator_id')
		.eq('id', tournamentId)
		.single();

	if (!tournament) throw error(404, 'Tournament not found');

	const { data: profile } = await supabase
		.from('users')
		.select('is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	if (!profile?.is_admin && tournament.creator_id !== user.id) {
		throw error(403, 'Not your tournament');
	}

	// Enrich results — try to link to deck submissions
	const enrichedResults = [];
	for (const result of results) {
		let submissionId = result.submission_id || null;
		let playerUserId = result.player_user_id || null;

		if (!submissionId && result.player_name) {
			const { data: matchedSub } = await supabase
				.from('deck_submissions')
				.select('id, user_id')
				.eq('tournament_id', tournamentId)
				.ilike('player_name', result.player_name)
				.maybeSingle();

			if (matchedSub) {
				submissionId = matchedSub.id;
				playerUserId = matchedSub.user_id;
			}
		}

		enrichedResults.push({
			tournament_id: tournamentId,
			submission_id: submissionId,
			player_name: result.player_name,
			player_user_id: playerUserId,
			final_standing: result.final_standing,
			placement_label: result.placement_label || null,
			match_wins: result.match_wins ?? null,
			match_losses: result.match_losses ?? null,
			match_draws: result.match_draws ?? null,
			entered_by: user.id
		});
	}

	const { error: insertErr } = await supabase
		.from('tournament_results')
		.upsert(enrichedResults, {
			onConflict: 'tournament_id,final_standing'
		});

	if (insertErr) {
		console.error('[tournament/results] Insert failed:', insertErr);
		throw error(500, 'Failed to save results');
	}

	// Mark tournament as having results
	const { error: updateErr } = await supabase
		.from('tournaments')
		.update({
			results_entered: true,
			results_entered_at: new Date().toISOString(),
			results_entered_by: user.id
		})
		.eq('id', tournamentId);

	if (updateErr) {
		console.error('[tournament/results] Tournament status update failed:', updateErr);
	}

	return json({ success: true, count: enrichedResults.length });
};
