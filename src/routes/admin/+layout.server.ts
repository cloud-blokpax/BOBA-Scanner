import { requireAdmin } from '$lib/server/auth/require-admin';
import type { LayoutServerLoad } from './$types';

/**
 * Server-side admin gate for everything under `/admin`.
 *
 * Covers:
 *   - All `/admin/*` page navigations (the layout load runs first)
 *   - `/admin/__data.json` and `/admin/<sub>/__data.json` data endpoints
 *     (SvelteKit serves these by re-running the layout/page server loads)
 *
 * Throws 403 (not a redirect) so probe attempts surface as denials in
 * `app_events` rather than silently 200ing through the SPA shell.
 */
export const load: LayoutServerLoad = async (event) => {
	await requireAdmin(event);
};
