import { redirect } from '@sveltejs/kit';
import { exchangeCode } from '$lib/server/ebay-seller-auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const user = locals.user;
	if (!user) throw redirect(303, '/settings?ebay=error&reason=session_expired');

	const ebayError = url.searchParams.get('error');
	if (ebayError) throw redirect(303, '/settings?ebay=declined');

	const returnedState = url.searchParams.get('state');
	const storedState = cookies.get('ebay_oauth_state');
	cookies.delete('ebay_oauth_state', { path: '/' });

	if (!returnedState || !storedState || returnedState !== storedState) throw redirect(303, '/settings?ebay=error&reason=state_mismatch');

	const code = url.searchParams.get('code');
	if (!code) throw redirect(303, '/settings?ebay=error&reason=no_code');

	try {
		await exchangeCode(code, user.id);
		throw redirect(303, '/settings?ebay=connected');
	} catch (err) {
		// SvelteKit redirect throws — re-throw it
		if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status >= 300 && (err as { status: number }).status < 400) throw err;
		console.error('[ebay-callback] Token exchange failed:', err);
		throw redirect(303, '/settings?ebay=error&reason=token_exchange');
	}
};
