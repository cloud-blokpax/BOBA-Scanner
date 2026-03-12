/**
 * GET /api/config — Deliver public configuration to the client
 *
 * Exposes only safe, public environment variables.
 * SvelteKit components should prefer $env/static/public directly,
 * but this endpoint exists for backward compatibility and non-Svelte consumers.
 */

import { json } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json(
		{
			supabaseUrl: publicEnv.PUBLIC_SUPABASE_URL ?? '',
			supabaseKey: publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '',
			googleClientId: publicEnv.PUBLIC_GOOGLE_CLIENT_ID ?? ''
		},
		{
			headers: {
				'Cache-Control': 'public, max-age=300'
			}
		}
	);
};
