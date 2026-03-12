import { createServerClient } from '@supabase/ssr';
import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env as publicEnv } from '$env/dynamic/public';

const supabaseHandle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(
		publicEnv.PUBLIC_SUPABASE_URL ?? '',
		publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '',
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				setAll: (cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>) => {
					cookies.forEach(({ name, value, options }) => {
						event.cookies.set(name, value, { ...options, path: '/' });
					});
				}
			}
		}
	);

	/**
	 * SECURITY: Always use getUser() for auth checks, never getSession() alone.
	 * getSession() reads from cookies which users can tamper with.
	 * getUser() validates the JWT with Supabase servers.
	 */
	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();

		if (!session) {
			return { session: null, user: null };
		}

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();

		if (error) {
			return { session: null, user: null };
		}

		return { session, user };
	};

	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

/**
 * Auth guard: protect routes that require authentication.
 * API routes handle their own auth via getUser() checks.
 */
const authGuard: Handle = async ({ event, resolve }) => {
	const protectedRoutes = ['/collection', '/deck', '/scan'];
	const isProtected = protectedRoutes.some((route) => event.url.pathname.startsWith(route));

	if (isProtected && !event.locals.user) {
		throw redirect(303, '/auth/login?redirectTo=' + event.url.pathname);
	}

	return resolve(event);
};

export const handle = sequence(supabaseHandle, authGuard);
