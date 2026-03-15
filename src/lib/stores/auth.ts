import { writable, derived } from 'svelte/store';
import type { User, Session } from '@supabase/supabase-js';
import { getSupabase } from '$lib/services/supabase';

export const user = writable<User | null>(null);
export const session = writable<Session | null>(null);

export const isAuthenticated = derived(user, ($user) => $user !== null);
export const userId = derived(user, ($user) => $user?.id ?? null);
export const userEmail = derived(user, ($user) => $user?.email ?? null);

/**
 * Initialize auth state from Supabase and listen for changes.
 * Call this once in the root layout's onMount.
 * Returns a no-op cleanup if Supabase is not configured (offline mode).
 */
export function initAuth() {
	const client = getSupabase();
	if (!client) return () => {};

	// Get initial session
	client.auth.getSession().then(({ data }) => {
		session.set(data.session);
		user.set(data.session?.user ?? null);
	}).catch((err) => {
		console.warn('Failed to get initial auth session:', err);
	});

	// Listen for auth changes
	const {
		data: { subscription }
	} = client.auth.onAuthStateChange((_event, newSession) => {
		session.set(newSession);
		user.set(newSession?.user ?? null);
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
