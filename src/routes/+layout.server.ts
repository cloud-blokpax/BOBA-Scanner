import type { LayoutServerLoad } from './$types';

// Cache profile lookups to avoid a DB query on every page navigation.
// TTL: 5 minutes. Evicted on auth state change (new session).
const profileCache = new Map<string, { isAdmin: boolean; isMember: boolean; ts: number }>();
const PROFILE_CACHE_TTL = 5 * 60 * 1000;

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('supabase:auth');

	const { session, user } = await locals.safeGetSession();

	let isAdmin = false;
	let isMember = false;

	if (user && locals.supabase) {
		const cached = profileCache.get(user.id);
		if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL) {
			isAdmin = cached.isAdmin;
			isMember = cached.isMember;
		} else {
			const { data: profile } = await locals.supabase
				.from('users')
				.select('is_admin, is_member')
				.eq('auth_user_id', user.id)
				.maybeSingle();
			isAdmin = profile?.is_admin === true;
			isMember = profile?.is_member === true;
			profileCache.set(user.id, { isAdmin, isMember, ts: Date.now() });
		}
	}

	return {
		session,
		user: user ? { ...user, is_admin: isAdmin, is_member: isMember } : null
	};
};
