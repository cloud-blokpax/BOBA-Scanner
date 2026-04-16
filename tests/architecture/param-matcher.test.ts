/**
 * Architecture validation — param matcher for [game=game] dynamic routes.
 *
 * Catches the "added a game to ALL_GAMES but forgot to add to VALID_GAMES
 * in src/params/game.ts" regression. When these are out of sync,
 * /<newgame>/collection returns 404 instead of matching the dynamic route.
 */

import { describe, it, expect } from 'vitest';
import { match as gameMatcher } from '../../src/params/game';
import { ALL_GAMES } from '../../src/lib/games/all-games';

describe('Architecture — param matcher', () => {
	it('accepts every registered game id', () => {
		for (const g of ALL_GAMES) {
			expect(gameMatcher(g.id), `param matcher should accept '${g.id}'`).toBe(true);
		}
	});

	it('rejects unregistered ids', () => {
		expect(gameMatcher('nonexistent')).toBe(false);
		expect(gameMatcher('')).toBe(false);
		expect(gameMatcher('BOBA')).toBe(false); // case-sensitive — only lowercase
		expect(gameMatcher('../etc/passwd')).toBe(false);
	});
});
