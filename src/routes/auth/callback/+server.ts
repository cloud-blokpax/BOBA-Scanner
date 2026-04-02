import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const rawRedirect = url.searchParams.get('redirectTo') ?? '/';
	// Prevent open redirect: only allow safe relative paths on the same origin
	// Block //, /\, and any protocol-relative or scheme-based redirects
	const isSafePath = rawRedirect.startsWith('/') &&
		!rawRedirect.startsWith('//') &&
		!rawRedirect.startsWith('/\\') &&
		!rawRedirect.includes('://');
	const redirectTo = isSafePath ? rawRedirect : '/';

	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (error) {
			console.error('Auth callback error:', error.message);
			throw redirect(303, '/auth/login?error=auth_failed');
		}

		// Link Supabase Auth user to existing users table (migration bridge)
		const {
			data: { user }
		} = await locals.supabase.auth.getUser();

		if (user?.email) {
			// First check if this auth user is already linked
			const { data: byAuth } = await locals.supabase
				.from('users')
				.select('id')
				.eq('auth_user_id', user.id)
				.maybeSingle();

			if (!byAuth) {
				// Not linked yet — try to link to existing user record by email
				const { data: existingUser } = await locals.supabase
					.from('users')
					.select('id, auth_user_id')
					.eq('email', user.email)
					.maybeSingle();

				if (existingUser && !existingUser.auth_user_id) {
					// Link existing unlinked user record — use WHERE clause to prevent race
					const { error: updateErr } = await locals.supabase
						.from('users')
						.update({ auth_user_id: user.id })
						.eq('id', existingUser.id)
						.is('auth_user_id', null);
					if (updateErr) {
						console.debug('[auth/callback] User link race condition handled:', updateErr);
					}
				} else if (!existingUser) {
					// No user record at all — create one
					const { error: profileError } = await locals.supabase.from('users').upsert({
						id: user.id,
						auth_user_id: user.id,
						google_id: (user.user_metadata?.provider_id as string) || null,
						email: user.email,
						name: user.user_metadata?.full_name || user.email.split('@')[0]
					}, { onConflict: 'id' });
					if (profileError) {
						console.error('[auth/callback] User profile upsert FAILED:', profileError.message);
					}
				}
				// If existingUser has a different auth_user_id, skip — already linked to another auth account
			}
		}
	}

	throw redirect(303, redirectTo);
};
