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
 */
export function initAuth() {
	const client = getSupabase();
	if (!client) return () => {};

	client.auth.getUser().then(({ data: { user: validatedUser }, error: authErr }) => {
		if (authErr || !validatedUser) {
			_session = null;
			_user = null;
			return;
		}
		_user = validatedUser;
		client.auth.getSession().then(({ data }) => {
			_session = data.session;
		}).catch(() => {
			_session = null;
		});
	}).catch((err) => {
		console.warn('Failed to get initial auth session:', err);
		_session = null;
		_user = null;
	});

	const {
		data: { subscription }
	} = client.auth.onAuthStateChange((_event, newSession) => {
		_session = newSession;
		_user = newSession?.user ?? null;
	});

	return () => subscription.unsubscribe();
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
