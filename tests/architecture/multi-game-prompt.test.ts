/**
 * Architecture validation — auto-detect prompt covers all registered games.
 *
 * When a new game is registered without updating the multi-game prompt,
 * auto-detect scans of the new game's cards will fail because Claude
 * won't know what to look for. This test catches that.
 */

import { describe, it, expect } from 'vitest';
import {
	MULTI_GAME_SYSTEM_PROMPT,
	MULTI_GAME_CARD_ID_TOOL,
} from '../../src/lib/games/multi-game-prompt';
import { ALL_GAMES } from '../../src/lib/games/all-games';

describe('Architecture — multi-game auto-detect prompt', () => {
	it('mentions every registered game by name in the system prompt', () => {
		for (const g of ALL_GAMES) {
			// Check either the full name or short name appears somewhere.
			const mentioned =
				MULTI_GAME_SYSTEM_PROMPT.includes(g.name) ||
				MULTI_GAME_SYSTEM_PROMPT.includes(g.shortName);
			expect(
				mentioned,
				`multi-game prompt must mention '${g.name}' or '${g.shortName}' — auto-detect will fail otherwise`
			).toBe(true);
		}
	});

	it("has 'game' field in its tool schema with every registered game id as an enum value", () => {
		const gameSchema = (MULTI_GAME_CARD_ID_TOOL.input_schema.properties as Record<string, { enum?: string[] }>)
			.game;
		expect(gameSchema, 'multi-game tool must have a `game` property').toBeDefined();
		expect(gameSchema.enum, '`game` must be an enum').toBeDefined();
		for (const g of ALL_GAMES) {
			expect(
				gameSchema.enum!.includes(g.id),
				`tool enum must include '${g.id}'`
			).toBe(true);
		}
	});

	it('tool is named "identify_card" to match scan endpoint tool_choice', () => {
		expect(MULTI_GAME_CARD_ID_TOOL.name).toBe('identify_card');
	});
});
