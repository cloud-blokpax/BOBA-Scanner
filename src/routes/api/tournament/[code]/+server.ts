import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const VALID_CHARS = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export const GET: RequestHandler = async ({ params, locals }) => {
	const code = params.code.toUpperCase();

	if (!VALID_CHARS.test(code)) {
		throw error(400, 'Invalid tournament code format');
	}

	if (!locals.supabase) {
		throw error(503, 'Service unavailable');
	}

	const { data, error: dbError } = await locals.supabase
		.from('tournaments')
		.select('id, code, name, max_heroes, max_plays, max_bonus, require_email, require_name, require_discord')
		.eq('code', code)
		.eq('is_active', true)
		.single();

	if (dbError || !data) {
		throw error(404, 'Tournament not found');
	}

	return json(data, {
		headers: { 'Cache-Control': 'public, max-age=60' }
	});
};
