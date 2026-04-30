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

	interface TournamentRow {
		id: string;
		code: string;
		name: string;
		max_heroes: number;
		max_plays: number;
		max_bonus: number;
		require_email: boolean;
		require_name: boolean;
		require_discord: boolean;
		format_id: string | null;
		deck_type: string | null;
		description: string | null;
		venue: string | null;
		event_date: string | null;
		entry_fee: string | null;
		prize_pool: string | null;
		max_players: number | null;
		submission_deadline: string | null;
		registration_closed: boolean;
		deadline_mode: string | null;
		is_active: boolean;
	}

	// Code-gated lookup goes through the SECURITY DEFINER RPC. Direct
	// SELECT on `tournaments` is blocked for anon/authenticated by the
	// post-lockdown RLS — the RPC returns a whitelisted column set
	// (no creator_id) for an active tournament matching the code.
	const { data: rows, error: dbError } = await locals.supabase
		.rpc('lookup_tournament_by_code', { p_code: code }) as {
			data: TournamentRow[] | null;
			error: { message: string; code?: string } | null;
		};

	if (dbError) {
		console.error('[tournament/code] RPC error:', dbError);
		throw error(500, 'Failed to look up tournament');
	}

	const data = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
	if (!data) {
		throw error(404, 'Tournament not found');
	}

	if (!data.is_active) {
		throw error(410, 'Tournament is no longer active');
	}

	if (data.registration_closed) {
		throw error(403, 'Registration for this tournament is closed');
	}

	// Strip internal fields before returning
	const { is_active: _, ...tournament } = data;

	return json(tournament, {
		headers: { 'Cache-Control': 'public, max-age=60' }
	});
};
