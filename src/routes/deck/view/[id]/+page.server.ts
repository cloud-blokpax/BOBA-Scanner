import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

interface SharedDeck {
	id: string;
	user_id: string;
	name: string;
	format_id: string;
	hero_card_ids: string[];
	play_entries: Array<{ cardNumber: string; setCode: string; name: string; dbs: number }>;
	created_at: string;
	view_count: number;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { id } = params;

	if (!id || !/^[\w-]{1,64}$/.test(id)) {
		throw error(400, 'Invalid deck ID');
	}

	if (!locals.supabase) {
		throw error(503, 'Database not available');
	}

	const { data: deck, error: fetchErr } = await locals.supabase
		.from('shared_decks')
		.select('*')
		.eq('id', id)
		.single();

	if (fetchErr || !deck) {
		throw error(404, 'Deck not found');
	}

	const typedDeck = deck as unknown as SharedDeck;

	// Increment view count (non-blocking)
	(locals.supabase.from('shared_decks') as unknown as { update: (val: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<unknown> } })
		.update({ view_count: (typedDeck.view_count || 0) + 1 })
		.eq('id', id)
		.then(() => {});

	return { deck: typedDeck };
};
