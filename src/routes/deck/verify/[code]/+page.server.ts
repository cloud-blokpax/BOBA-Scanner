import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { code } = params;

	if (!code || !/^[A-Za-z0-9]{6,12}$/.test(code)) {
		return { submission: null, source: null };
	}

	const client = locals.supabase;
	if (!client) return { submission: null, source: null };

	// Try deck_submissions first (new tournament system)
	const { data: submission } = await client
		.from('deck_submissions')
		.select('*, tournament:tournaments(name, code, format_id, event_date, venue)')
		.eq('verification_code', code)
		.maybeSingle();

	if (submission) {
		return { submission, source: 'deck_submission' };
	}

	// Fall back to deck_snapshots (legacy system)
	const { data: snapshot } = await client
		.from('deck_snapshots')
		.select('*')
		.eq('code', code)
		.maybeSingle();

	return { submission: snapshot || null, source: snapshot ? 'deck_snapshot' : null };
};
