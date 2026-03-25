import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user || !locals.supabase) throw redirect(303, '/auth/login');

	const { data: profile } = await locals.supabase
		.from('users')
		.select('is_organizer, is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	if (!profile?.is_organizer && !profile?.is_admin) {
		throw redirect(303, '/');
	}

	const { data: tournament } = await locals.supabase
		.from('tournaments')
		.select('*')
		.eq('code', params.code.toUpperCase())
		.single();

	if (!tournament) throw error(404, 'Tournament not found');

	if (tournament.creator_id !== user.id && !profile.is_admin) {
		throw error(403, 'Not your tournament');
	}

	const { data: submissions } = await locals.supabase
		.from('deck_submissions')
		.select('*')
		.eq('tournament_id', tournament.id)
		.order('submitted_at', { ascending: true });

	const { data: results } = await locals.supabase
		.from('tournament_results')
		.select('*')
		.eq('tournament_id', tournament.id)
		.order('final_standing', { ascending: true });

	return {
		tournament,
		submissions: submissions || [],
		results: results || [],
		isDeadlinePassed: tournament.submission_deadline
			? new Date(tournament.submission_deadline) < new Date()
			: false
	};
};
