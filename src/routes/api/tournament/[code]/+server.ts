import { json, error } from '@sveltejs/kit';
import { checkAnonPriceRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

const VALID_CHARS = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

export const GET: RequestHandler = async ({ params, locals, getClientAddress }) => {
	// ── Rate limiting (IP-based, same budget as price lookups) ──
	const ip = getClientAddress();
	const rateLimit = await checkAnonPriceRateLimit(ip);
	if (!rateLimit.success) {
		return json(
			{ error: 'Rate limited. Please wait before trying again.' },
			{
				status: 429,
				headers: {
					'X-RateLimit-Limit': String(rateLimit.limit),
					'X-RateLimit-Remaining': String(rateLimit.remaining),
					'X-RateLimit-Reset': String(rateLimit.reset)
				}
			}
		);
	}

	const code = params.code.toUpperCase();

	if (!VALID_CHARS.test(code)) {
		throw error(400, 'Invalid tournament code format');
	}

	if (!locals.supabase) {
		throw error(503, 'Service unavailable');
	}

	const { data, error: dbError } = await locals.supabase
		.from('tournaments')
		.select('id, code, name, max_heroes, max_plays, max_bonus, require_email, require_name, require_discord, format_id, deck_type, description, venue, event_date, entry_fee, prize_pool, max_players, submission_deadline, registration_closed, deadline_mode')
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
