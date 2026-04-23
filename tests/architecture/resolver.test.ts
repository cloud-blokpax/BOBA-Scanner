/**
 * Architecture validation — game resolver invariants.
 *
 * These tests don't exercise game-specific logic (the individual game
 * modules have their own tests). They guard the multi-game architecture
 * itself — catching regressions like "added Game 3 but forgot to register
 * it" or "GameConfig fields silently got out of sync across games."
 *
 * When adding a new game, all of these tests should pass without edits.
 */

import { describe, it, expect } from 'vitest';
import { resolveGameConfig, getAllGameConfigs } from '../../src/lib/games/resolver';
import { ALL_GAMES } from '../../src/lib/games/all-games';

describe('Architecture — resolver', () => {
	it('returns a valid GameConfig for every registered game in ALL_GAMES', async () => {
		for (const game of ALL_GAMES) {
			const config = await resolveGameConfig(game.id);
			expect(config, `resolveGameConfig('${game.id}') should return a config`).toBeDefined();
			expect(config.id, `${game.id} config id must match the registered id`).toBe(game.id);
		}
	});

	it('getAllGameConfigs returns one entry per ALL_GAMES entry', async () => {
		const configs = await getAllGameConfigs();
		expect(configs.length).toBe(ALL_GAMES.length);
		// Order must match the registry — the multi-game pipeline depends on
		// this ordering (ALL_GAMES[0] runs first in auto-detect mode).
		for (let i = 0; i < ALL_GAMES.length; i++) {
			expect(configs[i].id).toBe(ALL_GAMES[i].id);
		}
	});

	it('throws a helpful error for unregistered games', async () => {
		await expect(resolveGameConfig('nonexistent-game-id')).rejects.toThrow(
			/Unknown game/
		);
	});
});

describe('Architecture — GameConfig invariants', () => {
	it('every registered game has a non-empty id, name, and shortName', async () => {
		const configs = await getAllGameConfigs();
		for (const c of configs) {
			expect(c.id, 'id must be a non-empty string').toMatch(/^[a-z0-9_-]+$/);
			expect(c.name.length).toBeGreaterThan(0);
			expect(c.shortName.length).toBeGreaterThan(0);
		}
	});

	it('every registered game provides an extractCardNumber function', async () => {
		const configs = await getAllGameConfigs();
		for (const c of configs) {
			expect(typeof c.extractCardNumber).toBe('function');
			// Must safely handle garbage input — should never throw.
			expect(() => c.extractCardNumber('')).not.toThrow();
			expect(() => c.extractCardNumber('   ')).not.toThrow();
			expect(() => c.extractCardNumber('\n\t\r')).not.toThrow();
		}
	});

	// Claude prompts + card-id tool live in server-only lib/games/<game>/prompt.ts
	// (not on GameConfig — putting them there leaked ~14KB of strings into the
	// client bundle via the lazy-chunk path). The invariants moved with them.
	it('every registered game exposes a cardIdTool named "identify_card"', async () => {
		// This invariant matters: the scan endpoint hardcodes
		// tool_choice: { name: 'identify_card' }. Diverging here would
		// cause Claude to reject the request at tool-choice time.
		const [boba, wonders] = await Promise.all([
			import('../../src/lib/games/boba/prompt'),
			import('../../src/lib/games/wonders/prompt'),
		]);
		const tools = [
			{ id: 'boba', tool: boba.BOBA_CARD_ID_TOOL },
			{ id: 'wonders', tool: wonders.WONDERS_CARD_ID_TOOL },
		];
		for (const { id, tool } of tools) {
			expect(tool.name, `${id} tool name must be "identify_card"`).toBe('identify_card');
			expect(tool.input_schema).toBeDefined();
		}
	});

	it('every registered game has non-empty system + user prompts', async () => {
		const [boba, wonders] = await Promise.all([
			import('../../src/lib/games/boba/prompt'),
			import('../../src/lib/games/wonders/prompt'),
		]);
		const prompts = [
			{ id: 'boba', system: boba.BOBA_SYSTEM_PROMPT, user: boba.BOBA_USER_PROMPT },
			{ id: 'wonders', system: wonders.WONDERS_SYSTEM_PROMPT, user: wonders.WONDERS_USER_PROMPT },
		];
		for (const p of prompts) {
			expect(p.system.length, `${p.id} system prompt empty`).toBeGreaterThan(50);
			expect(p.user.length, `${p.id} user prompt empty`).toBeGreaterThan(20);
		}
	});

	it('every registered game has a theme with 4 hex colors', async () => {
		const configs = await getAllGameConfigs();
		const hex = /^#[0-9a-fA-F]{3,8}$/;
		for (const c of configs) {
			expect(c.theme.accentPrimary).toMatch(hex);
			expect(c.theme.accentSecondary).toMatch(hex);
			expect(c.theme.cardBg).toMatch(hex);
			expect(c.theme.textAccent).toMatch(hex);
		}
	});

	it('every registered game has at least one eBay search keyword', async () => {
		const configs = await getAllGameConfigs();
		for (const c of configs) {
			expect(
				c.ebaySearchKeywords.length,
				`${c.id} must have eBay keywords`
			).toBeGreaterThan(0);
		}
	});
});

describe('Architecture — game registry consistency', () => {
	it('ALL_GAMES ids are unique', () => {
		const ids = ALL_GAMES.map((g) => g.id);
		const unique = new Set(ids);
		expect(unique.size).toBe(ids.length);
	});

	it('ALL_GAMES short names are unique (filter pills would collide otherwise)', () => {
		const shortNames = ALL_GAMES.map((g) => g.shortName.toLowerCase());
		const unique = new Set(shortNames);
		expect(unique.size).toBe(shortNames.length);
	});

	it('ALL_GAMES icons are non-empty', () => {
		for (const g of ALL_GAMES) {
			expect(g.icon.length).toBeGreaterThan(0);
		}
	});
});
