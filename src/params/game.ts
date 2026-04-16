/**
 * Param matcher for the `[game=game]` dynamic segment.
 *
 * Accepts 'boba' and 'wonders'. SvelteKit will only match routes under
 * `src/routes/[game=game]/` when the URL segment is one of these.
 * Any other value results in a 404 or falls through to static routes.
 *
 * Keep in sync with VALID_GAME_IDS in src/lib/games/resolver.ts.
 */

import type { ParamMatcher } from '@sveltejs/kit';

const VALID_GAMES = new Set(['boba', 'wonders']);

export const match: ParamMatcher = (param) => VALID_GAMES.has(param);
