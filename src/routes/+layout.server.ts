import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('supabase:auth');

	const { session, user } = await locals.safeGetSession();

	let isAdmin = false;
	if (user && locals.supabase) {
		const { data: profile } = await locals.supabase
			.from('users')
			.select('is_admin')
			.eq('auth_user_id', user.id)
			.maybeSingle();
		isAdmin = profile?.is_admin === true;
	}

	return {
		session,
		user: user ? { ...user, is_admin: isAdmin } : null
	};
};
