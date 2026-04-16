/**
 * User game preferences — thin Supabase helper for user_game_prefs.
 *
 * Table was created in Phase 1 (Step 1.2):
 *   user_game_prefs(
 *     user_id UUID PK,
 *     default_game TEXT NULL,       -- null = show hub, 'boba' | 'wonders'
 *     enabled_games TEXT[] DEFAULT '{boba}',
 *     created_at, updated_at
 *   )
 *
 * Returns null when Supabase is unavailable or the user has no row.
 */

import { getSupabase } from '$lib/services/supabase';

export interface UserGamePrefs {
	default_game: string | null;
	enabled_games: string[];
}

/**
 * Fetch the signed-in user's game preferences.
 * Returns null when unauthenticated, Supabase missing, or the row doesn't exist.
 */
export async function fetchUserGamePrefs(userId: string): Promise<UserGamePrefs | null> {
	const client = getSupabase();
	if (!client || !userId) return null;

	try {
		const { data } = await client
			.from('user_game_prefs')
			.select('default_game, enabled_games')
			.eq('user_id', userId)
			.maybeSingle();
		if (!data) return null;
		return {
			default_game: (data as { default_game?: string | null }).default_game ?? null,
			enabled_games: (data as { enabled_games?: string[] }).enabled_games ?? ['boba'],
		};
	} catch (err) {
		console.debug('[user-game-prefs] fetch failed:', err);
		return null;
	}
}

/**
 * Upsert the signed-in user's game preferences.
 * Returns true on success, false on failure.
 */
export async function saveUserGamePrefs(
	userId: string,
	prefs: Partial<UserGamePrefs>
): Promise<boolean> {
	const client = getSupabase();
	if (!client || !userId) return false;

	try {
		const payload: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
		if ('default_game' in prefs) payload.default_game = prefs.default_game ?? null;
		if ('enabled_games' in prefs) payload.enabled_games = prefs.enabled_games ?? ['boba'];

		// Cast through unknown because user_game_prefs isn't in the generated
		// Supabase types (table added in Phase 1 Step 1.2 without regenerating).
		const { error } = await (client
			.from('user_game_prefs') as unknown as { upsert: (v: Record<string, unknown>, o: { onConflict: string }) => Promise<{ error: { message: string } | null }> })
			.upsert(payload, { onConflict: 'user_id' });
		if (error) {
			console.warn('[user-game-prefs] upsert failed:', error.message);
			return false;
		}
		return true;
	} catch (err) {
		console.warn('[user-game-prefs] upsert threw:', err);
		return false;
	}
}
