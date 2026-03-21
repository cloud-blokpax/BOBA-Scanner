import type { PageServerLoad } from './$types';

interface SharedDeck {
	id: string;
	name: string;
	format_id: string;
	hero_card_ids: string[];
	play_entries: Array<{ cardNumber: string; name: string; dbs: number }>;
	created_at: string;
	view_count: number;
	user_id: string;
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const formatFilter = url.searchParams.get('format') || '';
	const sortBy = url.searchParams.get('sort') || 'newest';
	const pageNum = parseInt(url.searchParams.get('page') || '1', 10);
	const perPage = 20;

	if (!locals.supabase) {
		return { decks: [], total: 0, formatFilter, sortBy, pageNum };
	}

	let query = locals.supabase
		.from('shared_decks')
		.select('*', { count: 'exact' });

	if (formatFilter) {
		query = query.eq('format_id', formatFilter);
	}

	if (sortBy === 'popular') {
		query = query.order('view_count', { ascending: false });
	} else {
		query = query.order('created_at', { ascending: false });
	}

	query = query.range((pageNum - 1) * perPage, pageNum * perPage - 1);

	const { data, count } = await query;
	const decks = (data || []) as unknown as SharedDeck[];

	return {
		decks,
		total: count || 0,
		formatFilter,
		sortBy,
		pageNum
	};
};
