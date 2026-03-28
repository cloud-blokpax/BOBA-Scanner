import playCardsData from '$lib/data/play-cards.json';
import { getDbsScoresMap, type PlayCardData } from '$lib/data/boba-dbs-scores';
import { TOURNAMENT_FORMATS } from '$lib/data/tournament-formats';
import { RELEASE_TO_SET_NAME } from '$lib/data/boba-config';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { id } = params;

	// Require authentication — deck editor is user-scoped
	const { user } = await locals.safeGetSession();
	if (!user) throw redirect(303, '/auth/login');

	// Load play card data (same as current deck builder)
	const playCardsBySet: Record<string, PlayCardData[]> = {};
	for (const card of playCardsData as PlayCardData[]) {
		const setCode = RELEASE_TO_SET_NAME[card.release] || card.release;
		if (!playCardsBySet[setCode]) playCardsBySet[setCode] = [];
		playCardsBySet[setCode].push(card);
	}

	const formats = TOURNAMENT_FORMATS.map(f => ({ id: f.id, name: f.name }));

	// Load the deck from Supabase
	if (!locals.supabase) {
		throw error(503, 'Database not available');
	}

	// user_decks is not yet in generated Database types — narrowed cast preserves client methods
	type AnySupabase = import('@supabase/supabase-js').SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
	const { data: deck, error: fetchErr } = await (locals.supabase as AnySupabase)
		.from('user_decks')
		.select('*')
		.eq('id', id)
		.eq('user_id', user.id)
		.single();

	if (fetchErr || !deck) {
		throw error(404, 'Deck not found');
	}

	return {
		deck,
		playCardsBySet,
		dbsScores: getDbsScoresMap(),
		formats
	};
};
