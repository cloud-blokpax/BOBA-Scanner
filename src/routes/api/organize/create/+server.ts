import { json, error } from '@sveltejs/kit';
import { requireAuth, requireSupabase, parseJsonBody, requireString } from '$lib/server/validate';
import type { RequestHandler } from './$types';

async function requireOrganizer(locals: App.Locals): Promise<{ id: string }> {
	const user = await requireAuth(locals);
	const supabase = requireSupabase(locals);

	const { data: profile } = await supabase
		.from('users')
		.select('is_organizer, is_admin')
		.eq('auth_user_id', user.id)
		.maybeSingle();

	if (!profile?.is_organizer && !profile?.is_admin) {
		throw error(403, 'Organizer access required');
	}

	return user;
}

function generateCode(): string {
	const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireOrganizer(locals);
	const supabase = requireSupabase(locals);
	const body = await parseJsonBody(request);

	const name = requireString(body.name, 'name', 200);
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

	// Generate unique code (retry up to 5 times for collision)
	let code = '';
	for (let attempt = 0; attempt < 5; attempt++) {
		code = generateCode();
		const { data: existing } = await supabase
			.from('tournaments')
			.select('id')
			.eq('code', code)
			.maybeSingle();
		if (!existing) break;
	}

	const { data: tournament, error: insertErr } = await supabase
		.from('tournaments')
		.insert({
			creator_id: user.id,
			code,
			name,
			format_id: formatId,
			description: (body.description as string) || null,
			venue: (body.venue as string) || null,
			event_date: (body.event_date as string) || null,
			entry_fee: (body.entry_fee as string) || null,
			prize_pool: (body.prize_pool as string) || null,
			max_players: (body.max_players as number) || null,
			deadline_mode: deadlineMode,
			submission_deadline: (body.submission_deadline as string) || null,
			max_heroes: 60,
			max_plays: 30,
			max_bonus: 25,
			require_email: true,
			require_name: true,
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
};
