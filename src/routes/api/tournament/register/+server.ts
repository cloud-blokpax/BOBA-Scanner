import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.supabase) {
		throw error(503, 'Service unavailable');
	}

	let body;
	try {
		body = await request.json();
	} catch (err) {
		console.debug('[api/tournament/register] JSON parse failed:', err);
		throw error(400, 'Invalid JSON body');
	}
	const { tournament_id, email, name, discord_id, deck_csv } = body;

	if (!tournament_id || !email) {
		throw error(400, 'tournament_id and email are required');
	}

	// Validate the email format
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw error(400, 'Invalid email format');
	}

	// Get tournament to validate requirements
	const { data: tournament, error: tError } = await locals.supabase
		.from('tournaments')
		.select('id, require_email, require_name, require_discord, is_active, usage_count')
		.eq('id', tournament_id)
		.single();

	if (tError || !tournament) {
		throw error(404, 'Tournament not found');
	}

	if (!tournament.is_active) {
		throw error(400, 'Tournament is not active');
	}

	if (tournament.require_name && !name?.trim()) {
		throw error(400, 'Name is required for this tournament');
	}

	if (tournament.require_discord && !discord_id?.trim()) {
		throw error(400, 'Discord ID is required for this tournament');
	}

	// Get auth user id if logged in
	const { session, user } = await locals.safeGetSession();
	const userId = user?.id ?? null;

	// Upsert registration (update if same tournament + email)
	const { data: registration, error: regError } = await locals.supabase
		.from('tournament_registrations')
		.upsert(
			{
				tournament_id,
				user_id: userId,
				email: email.trim(),
				name: name?.trim() || null,
				discord_id: discord_id?.trim() || null,
				deck_csv: deck_csv || null
			},
			{ onConflict: 'tournament_id,email' }
		)
		.select()
		.single();

	if (regError) {
		console.error('Registration error:', regError);
		throw error(500, 'Failed to register');
	}

	// Atomically increment usage_count using RPC to avoid read-modify-write race condition.
	// Falls back to direct update using the value we already fetched (still racy under
	// high concurrency but avoids the separate read that doubles the race window).
	const { error: rpcError } = await locals.supabase
		.rpc('increment_tournament_usage' as never, { tid: tournament_id } as never);
	if (rpcError) {
		await locals.supabase
			.from('tournaments')
			.update({ usage_count: ((tournament.usage_count as number) || 0) + 1 } as never)
			.eq('id', tournament_id);
	}

	return json({ success: true, registration });
};
