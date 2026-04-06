import type { User, Session } from '@supabase/supabase-js';
import { getSupabase } from '$lib/services/supabase';

// ── Private mutable state ──────────────────────────────────
let _user = $state<User | null>(null);
let _session = $state<Session | null>(null);

// ── Public reactive accessors (read $state in calling context) ──
export function user(): User | null { return _user; }
export function session(): Session | null { return _session; }
export function isAuthenticated(): boolean { return _user !== null; }
export function userId(): string | null { return _user?.id ?? null; }
export function userEmail(): string | null { return _user?.email ?? null; }

/**
 * Initialize auth state from Supabase and listen for changes.
 * Returns a cleanup function. The returned promise resolves once the
 * initial auth state is determined, preventing race conditions between
 * getUser() and onAuthStateChange.
 */
let _initPromise: Promise<void> | null = null;

export function initAuth(): { ready: Promise<void>; cleanup: () => void } {
	const client = getSupabase();
	if (!client) return { ready: Promise.resolve(), cleanup: () => {} };

	// Resolve initial auth state BEFORE registering the listener
	// to prevent onAuthStateChange from overwriting getUser() results
	if (!_initPromise) {
		_initPromise = (async () => {
			try {
				const { data: { user: validatedUser }, error: authErr } = await client.auth.getUser();
				if (authErr || !validatedUser) {
					if (authErr) {
						console.warn('[auth] getUser() failed during init:', authErr.message);
					}
					_session = null;
					_user = null;
					return;
				}
				_user = validatedUser;
				const { data } = await client.auth.getSession();
				_session = data.session;
			} catch (err) {
				console.warn('Failed to get initial auth session:', err);
				_session = null;
				_user = null;
			}
		})();
	}

	// Register listener AFTER initial state is set to avoid race
	const {
		data: { subscription }
	} = client.auth.onAuthStateChange((event, newSession) => {
		// Skip INITIAL_SESSION — we handle it above via getUser()
		if (event === 'INITIAL_SESSION') return;
		_session = newSession;
		_user = newSession?.user ?? null;
	});

	return {
		ready: _initPromise,
		cleanup: () => subscription.unsubscribe()
	};
}

/**
 * Sign in with Google OAuth via Supabase Auth (PKCE flow).
 */
export async function signInWithGoogle(redirectTo?: string) {
	const client = getSupabase();
	if (!client) throw new Error('Supabase is not configured');

	const { error } = await client.auth.signInWithOAuth({
		provider: 'google',
		options: {
			redirectTo: redirectTo
				? `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`
				: `${window.location.origin}/auth/callback`
		}
	});

	if (error) {
		console.error('Google sign-in error:', error.message);
		throw error;
	}
}

/**
 * Sign out the current user.
 */
export async function signOut() {
	const client = getSupabase();
	if (!client) return;

	const { error } = await client.auth.signOut();
	if (error) {
		console.error('Sign out error:', error.message);
		throw error;
	}
}
