import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { requireAdmin } from '$lib/server/admin-guard';

export const load = async ({ locals }) => {
	if (dev) return {};
	try {
		await requireAdmin(locals);
	} catch {
		throw error(404, 'Not found');
	}
	return {};
};
