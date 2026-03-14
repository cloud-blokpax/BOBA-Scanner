import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const rawRedirect = url.searchParams.get('redirectTo') ?? '/';
	// Prevent open redirect: only allow relative paths on the same origin
	const redirectTo = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/';

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
			// Try to link to existing user record by email
			const { data: existingUser } = await locals.supabase
				.from('users')
				.select('id')
				.eq('email', user.email)
				.maybeSingle();

			if (existingUser) {
				// Link existing user record to auth
				await locals.supabase
					.from('users')
					.update({ auth_user_id: user.id })
					.eq('email', user.email)
					.is('auth_user_id', null);
			} else {
				// Create user record if none exists
				const googleId =
					user.user_metadata?.provider_id ||
					user.app_metadata?.provider_id ||
					user.id;
				await locals.supabase.from('users').insert({
					id: user.id,
					google_id: googleId,
					email: user.email,
					name: user.user_metadata?.full_name || user.email.split('@')[0]
				});
			}
		}
	}

	throw redirect(303, redirectTo);
};
