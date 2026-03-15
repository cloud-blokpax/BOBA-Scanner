import { writable, derived } from 'svelte/store';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '$lib/services/supabase';

export const user = writable<User | null>(null);
export const session = writable<Session | null>(null);

export const isAuthenticated = derived(user, ($user) => $user !== null);
export const userId = derived(user, ($user) => $user?.id ?? null);
export const userEmail = derived(user, ($user) => $user?.email ?? null);

/**
 * Initialize auth state from Supabase and listen for changes.
 * Call this once in the root layout's onMount.
 */
export function initAuth() {
	// Get initial session
	supabase.auth.getSession().then(({ data }) => {
		session.set(data.session);
		user.set(data.session?.user ?? null);
	}).catch((err) => {
		console.warn('Failed to get initial auth session:', err);
	});

	// Listen for auth changes
	const {
		data: { subscription }
	} = supabase.auth.onAuthStateChange((_event, newSession) => {
		session.set(newSession);
		user.set(newSession?.user ?? null);
	});

	return () => subscription.unsubscribe();
}

/**
 * Sign in with Google OAuth via Supabase Auth (PKCE flow).
 */
export async function signInWithGoogle(redirectTo?: string) {
	const { error } = await supabase.auth.signInWithOAuth({
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
	const { error } = await supabase.auth.signOut();
	if (error) {
		console.error('Sign out error:', error.message);
		throw error;
	}
}
