import { json, error } from '@sveltejs/kit';
import { requireAuth, requireSupabase, parseJsonBody, requireString } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import { apiError, rateLimited } from '$lib/server/api-response';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

async function requireOrganizer(locals: App.Locals) {
	const user = await requireAuth(locals);
	const supabase = requireSupabase(locals);

	const { data: profile } = await supabase
		.from('users')
		.select('id, is_organizer, is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	if (!profile?.is_organizer && !profile?.is_admin) {
		throw error(403, 'Organizer access required');
	}

	return { id: user.id, publicUserId: profile.id, supabase };
}

function generateCode(): string {
	const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const { supabase, ...organizer } = await requireOrganizer(locals);

		const rateLimit = await checkMutationRateLimit(organizer.id);
		if (!rateLimit.success) {
			return rateLimited(rateLimit);
		}

		const body = await parseJsonBody(request);

		const name = requireString(body.name, 'name', 200);
		const deckType = (body.deck_type as string) || 'sealed';
		if (!['constructed', 'sealed'].includes(deckType)) {
			throw error(400, 'Invalid deck_type');
		}
		const formatId = requireString(body.format_id, 'format_id', 50);
		const deadlineMode = (body.deadline_mode as string) || 'manual';

		if (!['manual', 'datetime', 'both'].includes(deadlineMode)) {
			throw error(400, 'Invalid deadline_mode');
		}

		// Validate format exists (unless custom)
		if (formatId !== 'custom') {
			const { getFormat } = await import('$lib/data/tournament-formats');
			const format = getFormat(formatId);
			if (!format) throw error(400, `Unknown format: ${formatId}`);
		}

		// Generate unique code (retry up to 5 times for collision). The
		// uniqueness check has to scan across every organizer's tournaments,
		// which the user-scoped client can't do post-RLS-lockdown — switch
		// to the admin client for the check only. Insert below stays on the
		// user-scoped client so RLS still attributes ownership correctly.
		const adminClient = getAdminClient();
		if (!adminClient) {
			throw error(503, 'Service unavailable');
		}
		let code = '';
		let codeIsUnique = false;
		for (let attempt = 0; attempt < 5; attempt++) {
			code = generateCode();
			const { data: existing } = await adminClient
				.from('tournaments')
				.select('id')
				.eq('code', code)
				.maybeSingle();
			if (!existing) {
				codeIsUnique = true;
				break;
			}
		}
		if (!codeIsUnique) {
			throw error(500, 'Could not generate unique tournament code. Please try again.');
		}

		// Validate deck size values
		const maxHeroes = typeof body.max_heroes === 'number' ? Math.max(1, Math.min(120, body.max_heroes)) : 60;
		const maxPlays = typeof body.max_plays === 'number' ? Math.max(0, Math.min(60, body.max_plays)) : 30;
		const maxBonus = typeof body.max_bonus === 'number' ? Math.max(0, Math.min(50, body.max_bonus)) : 25;

		const { data: tournament, error: insertErr } = await supabase
			.from('tournaments')
			.insert({
				creator_id: organizer.publicUserId,
				code,
				name,
				deck_type: deckType,
				format_id: formatId,
				description: (body.description as string) || null,
				venue: (body.venue as string) || null,
				event_date: (body.event_date as string) || null,
				max_players: (body.max_players as number) || null,
				deadline_mode: deadlineMode,
				submission_deadline: (body.submission_deadline as string) || null,
				max_heroes: maxHeroes,
				max_plays: maxPlays,
				max_bonus: maxBonus,
				require_email: true,
				require_name: body.require_name === true,
				require_discord: body.require_discord === true,
				is_active: true
			})
			.select()
			.single();

		if (insertErr) {
			console.error('[organize/create] Insert failed:', insertErr);
			throw error(500, 'Failed to create tournament');
		}

		return json({
			success: true,
			tournament,
			share_url: `/tournaments/enter?code=${code}`
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[organize/create] Unexpected error:', err);
		return apiError('Internal server error', 500);
	}
};
