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

	// Check if the requester owns this deck
	const { user } = await locals.safeGetSession();

	// Try user_decks — only allow if requester is the owner or deck is shared
	const { data: deck } = await locals.supabase
		.from('user_decks')
		.select('*')
		.eq('id', id)
		.maybeSingle();

	let typedDeck = deck as unknown as (SharedDeck & { is_shared?: boolean });

	// Only expose user_decks to the owner or if explicitly shared
	if (typedDeck && typedDeck.user_id !== user?.id && !typedDeck.is_shared) {
		typedDeck = null as unknown as SharedDeck;
	}

	if (!typedDeck) {
		const { data: shared } = await locals.supabase
			.from('shared_decks')
			.select('*')
			.eq('id', id)
			.single();
		if (!shared) throw error(404, 'Deck not found');
		typedDeck = shared as unknown as SharedDeck;
	}

	// Increment view count atomically (non-blocking)
	Promise.resolve(locals.supabase.rpc('increment_shared_deck_views', { deck_id: id })).catch(() => {});

	return { deck: typedDeck };
};
