import { createServerClient } from '@supabase/ssr';
import { type Handle, redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { env as publicEnv } from '$env/dynamic/public';
import { BOBA_RATE_LIMITS } from '$lib/data/boba-config';

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
	if (globalRateMap.size > BOBA_RATE_LIMITS.globalRateLimitMapMaxSize) {
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

	try {
		event.locals.supabase = createServerClient(supabaseUrl, supabaseKey, {
			cookies: {
				getAll: () => {
					try {
						return event.cookies.getAll();
					} catch (err) {
						console.error('[auth] Failed to read cookies:', err);
						return [];
					}
				},
				setAll: (
					cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>
				) => {
					try {
						cookies.forEach(({ name, value, options }) => {
							event.cookies.set(name, value, { ...options, path: '/' });
						});
					} catch (err) {
						console.error('[auth] Failed to set cookies:', err);
					}
				}
			}
		});
	} catch (err) {
		// createServerClient can throw on corrupted cookies (e.g. invalid base64
		// in chunked Supabase auth tokens left by a previous mobile session).
		console.error('[auth] createServerClient crashed — falling back to anonymous:', err);
		event.locals.safeGetSession = async () => ({ session: null, user: null });
		event.locals.session = null;
		event.locals.user = null;
		return resolve(event);
	}

	/**
	 * SECURITY: Always use getUser() for auth checks, never getSession() alone.
	 * getSession() reads from cookies which users can tamper with.
	 * getUser() validates the JWT with Supabase servers.
	 */
	let sessionCache: { session: import('@supabase/supabase-js').Session | null; user: import('@supabase/supabase-js').User | null } | null = null;

	event.locals.safeGetSession = async () => {
		if (sessionCache) return sessionCache;

		try {
			const {
				data: { session }
			} = await event.locals.supabase.auth.getSession();

			if (!session) {
				sessionCache = { session: null, user: null };
				return sessionCache;
			}

			// Always validate with getUser() — never trust session.user from cookies
			const {
				data: { user },
				error
			} = await event.locals.supabase.auth.getUser();

			if (error) {
				console.warn('[auth] getUser() failed:', error.message);
				sessionCache = { session: null, user: null };
				return sessionCache;
			}

			sessionCache = { session, user };
			return sessionCache;
		} catch (err) {
			console.error('[auth] safeGetSession crashed (likely corrupted cookies):', err);
			sessionCache = { session: null, user: null };
			return sessionCache;
		}
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
 * Security headers: add defense-in-depth headers to all responses.
 */
const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
	return response;
};

/**
 * Auth guard: protect routes that require authentication.
 * API routes handle their own auth via getUser() checks.
 */
const authGuard: Handle = async ({ event, resolve }) => {
	// Shared-route protections (game-agnostic) plus game-scoped sub-paths
	// under `/boba/...` and `/wonders/...` that require authentication.
	const protectedRoutes = [
		'/collection', '/sell', '/admin', '/grader', '/export',
		'/market', '/set-completion', '/tournaments', '/settings',
		'/organize', '/war-room',
		// Game-scoped protected routes
		'/boba/collection', '/boba/set-completion', '/boba/market',
		'/wonders/collection', '/wonders/set-completion', '/wonders/market',
		'/wonders/dragon-points',
		// Dev spike routes (admin-gated in their +page.server.ts loaders)
		'/dev',
	];
	const isProtected = protectedRoutes.some((route) => event.url.pathname.startsWith(route));

	if (isProtected && !event.locals.user) {
		throw redirect(303, '/auth/login?redirectTo=' + encodeURIComponent(event.url.pathname));
	}

	return resolve(event);
};

/**
 * Lightweight API request logger for observability.
 * Only logs API routes — skips page navigation and static assets.
 */
const requestLogger: Handle = async ({ event, resolve }) => {
	if (!event.url.pathname.startsWith('/api/')) {
		return resolve(event);
	}

	const start = performance.now();
	const response = await resolve(event);
	const duration = Math.round(performance.now() - start);

	// Structured log line — parseable by log aggregators
	console.log(JSON.stringify({
		type: 'api_request',
		method: event.request.method,
		path: event.url.pathname,
		status: response.status,
		duration_ms: duration,
		user_id: event.locals.user?.id ?? null
	}));

	return response;
};

export const handle = sequence(globalRateLimit, supabaseHandle, securityHeaders, authGuard, requestLogger);

export const handleError = async ({ error, event, status, message }: { error: unknown; event: { url: URL; request: Request }; status: number; message: string }) => {
	const ua = event.request.headers.get('user-agent') || 'unknown';
	console.error(JSON.stringify({
		type: 'unhandled_error',
		status,
		message,
		path: event.url.pathname,
		ua: ua.slice(0, 200),
		error: error instanceof Error ? { message: error.message, stack: error.stack?.slice(0, 500) } : String(error)
	}));

	// Persist to app_events. Best-effort — never blocks the response.
	void import('$lib/server/diagnostics').then(({ logEvent }) => {
		logEvent({
			level: status >= 500 ? 'fatal' : 'error',
			event: 'sveltekit.unhandled_error',
			error,
			errorCode: `http_${status}`,
			context: {
				path: event.url.pathname,
				ua: ua.slice(0, 200),
				message
			}
		});
	}).catch(() => { /* logger failures must never escape */ });

	return { message: 'Something went wrong on our end.' };
};
