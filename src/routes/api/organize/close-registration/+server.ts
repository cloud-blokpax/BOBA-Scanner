import { json, error } from '@sveltejs/kit';
import { requireAuth, requireSupabase, parseJsonBody, requireString } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);
	const supabase = requireSupabase(locals);

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

	try {
	const body = await parseJsonBody(request);

	const tournamentId = requireString(body.tournament_id, 'tournament_id');

	// Verify organizer/admin role
	const { data: profile } = await supabase
		.from('users')
		.select('id, is_organizer, is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	if (!profile?.is_organizer && !profile?.is_admin) {
		throw error(403, 'Organizer access required');
	}

	// Verify tournament ownership
	const { data: tournament } = await supabase
		.from('tournaments')
		.select('id, creator_id')
		.eq('id', tournamentId)
		.single();

	if (!tournament) throw error(404, 'Tournament not found');
	if (tournament.creator_id !== profile.id && !profile.is_admin) {
		throw error(403, 'Not your tournament');
	}

	const { error: updateErr } = await supabase
		.from('tournaments')
		.update({ registration_closed: true })
		.eq('id', tournamentId);

	if (updateErr) {
		console.error('[organize/close-registration] DB error:', updateErr.message);
		throw error(500, 'Failed to close registration');
	}

	return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[organize/close-registration] Unexpected error:', err);
		throw error(500, 'Internal server error');
	}
};
