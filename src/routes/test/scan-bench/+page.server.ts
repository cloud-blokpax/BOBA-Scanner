import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';

export function load() {
	if (!dev && process.env.ALLOW_BENCH_PAGE !== 'true') {
		throw error(404, 'Not found');
	}
	return {};
}
