import { json, error } from '@sveltejs/kit';
import { checkCollectionRateLimit } from '$lib/server/rate-limit';
import { incrementTournamentUsageRpc } from '$lib/server/rpc';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	if (!locals.supabase) {
		throw error(503, 'Service unavailable');
	}

	// Rate limit registration requests
	const { user } = await locals.safeGetSession();
	const rateLimitKey = user?.id ?? getClientAddress();
	const rateLimit = await checkCollectionRateLimit(rateLimitKey);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429 });
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

	// Validate deck_csv size to prevent database bloat
	if (deck_csv && typeof deck_csv === 'string' && deck_csv.length > 50000) {
		throw error(400, 'Deck CSV too large (max 50KB)');
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

	// If authenticated, enforce that the registration email matches the session email.
	// This prevents users from squatting on other people's email addresses.
	if (user && locals.supabase) {
		const { data: { user: authUser } } = await locals.supabase.auth.getUser();
		if (authUser?.email && email.trim().toLowerCase() !== authUser.email.toLowerCase()) {
			throw error(400, 'Registration email must match your account email');
		}
	}

	// Auth user id (already fetched for rate limiting above)
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

	// Atomically increment usage_count using typed RPC wrapper.
	// Falls back to direct update if the RPC doesn't exist.
	try {
		await incrementTournamentUsageRpc(locals.supabase, tournament_id);
	} catch {
		await locals.supabase
			.from('tournaments')
			.update({ usage_count: ((tournament.usage_count as number) || 0) + 1 } as never)
			.eq('id', tournament_id);
	}

	return json({ success: true, registration });
};
