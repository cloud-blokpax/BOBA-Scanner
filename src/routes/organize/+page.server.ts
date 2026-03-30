import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!user) throw redirect(303, '/auth/login?redirectTo=/organize');

	let tournaments: Record<string, unknown>[] = [];
	if (locals.supabase) {
		const { data: profile } = await locals.supabase
			.from('users')
			.select('id, is_organizer, is_admin')
			.eq('auth_user_id', user.id)
			.maybeSingle();

		if (!profile?.is_organizer && !profile?.is_admin) {
			throw redirect(303, '/');
		}

		// Load organizer's tournaments using public user ID
		const { data } = await locals.supabase
			.from('tournaments')
			.select('*, deck_submissions(count)')
			.eq('creator_id', profile.id)
			.order('created_at', { ascending: false });
		tournaments = data || [];
	}

	return { session, user, tournaments };
};
