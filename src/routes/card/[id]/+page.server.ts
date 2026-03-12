import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

// ISR: cache card pages for 1 hour on Vercel CDN
export const config = {
	isr: {
		expiration: 3600
	}
};

export const load: PageServerLoad = async ({ params, locals }) => {
	const { data: card, error: fetchError } = await locals.supabase
		.from('cards')
		.select('*')
		.eq('id', params.id)
		.single();

	if (fetchError || !card) {
		throw error(404, 'Card not found');
	}

	return { card };
};
