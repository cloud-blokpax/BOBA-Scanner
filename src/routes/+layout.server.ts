import type { LayoutServerLoad } from './$types';

// Cache profile lookups to avoid a DB query on every page navigation.
// TTL: 5 minutes. Evicted on auth state change (new session).
const profileCache = new Map<string, { isAdmin: boolean; isPro: boolean; proUntil: string | null; ts: number }>();
const PROFILE_CACHE_TTL = 5 * 60 * 1000;
const PROFILE_CACHE_MAX_SIZE = 500;

/** Evict stale entries to prevent unbounded memory growth on warm instances. */
function evictStaleProfiles(): void {
	if (profileCache.size <= PROFILE_CACHE_MAX_SIZE) return;
	const now = Date.now();
	for (const [key, entry] of profileCache) {
		if (now - entry.ts > PROFILE_CACHE_TTL * 2) {
			profileCache.delete(key);
		}
	}
}

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('supabase:auth');
	evictStaleProfiles();

	try {
		const { session, user } = await locals.safeGetSession();

		let isAdmin = false;
		let isPro = false;
		let proUntil: string | null = null;

		if (user && locals.supabase) {
			const cached = profileCache.get(user.id);
			if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL) {
				isAdmin = cached.isAdmin;
				isPro = cached.isPro;
				proUntil = cached.proUntil;
			} else {
				const { data: profile } = await locals.supabase
					.from('users')
					.select('is_admin, is_pro, pro_until')
					.eq('auth_user_id', user.id)
					.maybeSingle();
				isAdmin = profile?.is_admin === true
					|| user.app_metadata?.is_admin === true;
				isPro = profile?.is_pro === true;
				proUntil = profile?.pro_until ?? null;
				profileCache.set(user.id, { isAdmin, isPro, proUntil, ts: Date.now() });
			}

			// Phase 8: Server-side Pro expiry check
			if (isPro && proUntil) {
				const proUntilDate = new Date(proUntil);
				if (proUntilDate < new Date()) {
					isPro = false;
					// Await the cleanup so it completes before Vercel tears down the function.
					// Cast needed because is_pro isn't in the generated Insert type.
					try {
						await locals.supabase.from('users')
							.update({ is_pro: false } as Record<string, unknown>)
							.eq('auth_user_id', user.id);
						profileCache.delete(user.id);
					} catch (err) {
						console.warn('[layout] Pro expiry cleanup failed:', err);
						profileCache.delete(user.id);
					}
				}
			}
		}

		return {
			session,
			user: user ? { ...user, is_admin: isAdmin, is_pro: isPro, pro_until: proUntil } : null
		};
	} catch (err) {
		// Catch any unexpected error (corrupted cookies, Supabase timeouts, etc.)
		// to prevent 500 errors — render as unauthenticated instead.
		console.error('[layout.server] load crashed — falling back to anonymous:', err);
		return { session: null, user: null };
	}
};
