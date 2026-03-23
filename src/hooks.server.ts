import { createServerClient } from '@supabase/ssr';
import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env as publicEnv } from '$env/dynamic/public';

// ── Global rate limiter (100 requests/minute per IP) ─────────
const globalRateMap = new Map<string, { count: number; windowStart: number }>();
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX_REQUESTS = 100;

const globalRateLimit: Handle = async ({ event, resolve }) => {
	// Skip rate limiting for static assets
	if (event.url.pathname.startsWith('/_app/') || event.url.pathname.startsWith('/icon-')) {
		return resolve(event);
	}

	const ip = event.getClientAddress();
	const now = Date.now();
	const entry = globalRateMap.get(ip) || { count: 0, windowStart: now };

	if (now - entry.windowStart > GLOBAL_WINDOW_MS) {
		entry.count = 0;
		entry.windowStart = now;
	}

	if (entry.count >= GLOBAL_MAX_REQUESTS) {
		globalRateMap.set(ip, entry);
		return new Response(
			JSON.stringify({ error: 'Too many requests' }),
			{ status: 429, headers: { 'Content-Type': 'application/json' } }
		);
	}

	entry.count++;
	globalRateMap.set(ip, entry);

	// Periodic cleanup to prevent memory leak
	if (globalRateMap.size > 5000) {
		for (const [k, v] of globalRateMap) {
			if (now - v.windowStart > GLOBAL_WINDOW_MS * 2) globalRateMap.delete(k);
		}
	}

	return resolve(event);
};

const supabaseHandle: Handle = async ({ event, resolve }) => {
	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const supabaseKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '';

	// When Supabase isn't configured, skip client creation and provide no-op auth
	if (!supabaseUrl || !supabaseKey) {
		event.locals.safeGetSession = async () => ({ session: null, user: null });
		event.locals.session = null;
		event.locals.user = null;
		return resolve(event);
	}

	event.locals.supabase = createServerClient(supabaseUrl, supabaseKey, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (
				cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>
			) => {
				cookies.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
			}
		}
	});

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

		// Trust the session if the JWT has >5 minutes remaining.
		// This avoids a round-trip to Supabase Auth on every request.
		const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
		const fiveMinutes = 5 * 60 * 1000;
		if (expiresAt - Date.now() > fiveMinutes) {
			return { session, user: session.user };
		}

		// Near expiry or no expiry info — validate with getUser()
		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();

		if (error) {
			console.warn('[auth] getUser() failed:', error.message);
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
	const protectedRoutes = ['/collection', '/deck', '/admin', '/grader', '/export', '/marketplace', '/set-completion', '/tournaments', '/settings'];
	const isProtected = protectedRoutes.some((route) => event.url.pathname.startsWith(route));

	if (isProtected && !event.locals.user) {
		throw redirect(303, '/auth/login?redirectTo=' + encodeURIComponent(event.url.pathname));
	}

	return resolve(event);
};

export const handle = sequence(globalRateLimit, supabaseHandle, authGuard);
