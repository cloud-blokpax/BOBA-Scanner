import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const redirectTo = url.searchParams.get('redirectTo') ?? '/';

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
			await locals.supabase
				.from('users')
				.update({ auth_user_id: user.id })
				.eq('email', user.email)
				.is('auth_user_id', null);
		}
	}

	throw redirect(303, redirectTo);
};
