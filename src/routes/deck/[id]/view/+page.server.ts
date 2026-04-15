import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

interface DeckView {
	id: string;
	user_id: string;
	name: string;
	format_id: string;
	hero_card_ids: string[];
	play_entries: Array<{ cardNumber: string; setCode: string; name: string; dbs: number }>;
	is_shared: boolean;
	created_at: string;
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

	let typedDeck: DeckView | null = deck as DeckView | null;

	// Only expose user_decks to the owner or if explicitly shared
	if (typedDeck && typedDeck.user_id !== user?.id && !typedDeck.is_shared) {
		typedDeck = null;
	}

	if (!typedDeck) {
		throw error(404, 'Deck not found');
	}

	// Increment view count atomically (non-blocking)
	Promise.resolve(locals.supabase.rpc('increment_shared_deck_views', { deck_id: id })).catch((err) => console.warn('[deck-view] View count increment failed:', err));

	return { deck: typedDeck };
};
