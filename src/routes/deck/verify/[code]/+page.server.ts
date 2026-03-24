import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const { code } = params;

	if (!code || !/^[A-Za-z0-9]{6,12}$/.test(code)) {
		return { snapshot: null };
	}

	const client = locals.supabase;
	if (!client) return { snapshot: null };

	const { data: snapshot } = await client
		.from('deck_snapshots')
		.select('*')
		.eq('code', code)
		.single();

	return { snapshot: snapshot || null };
};
