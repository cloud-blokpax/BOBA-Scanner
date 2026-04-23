/**
 * Game 3 — GameConfig implementation (skeleton).
 *
 * This file exists as a compile-time template showing how a third game
 * plugs into the architecture. It is **not** registered in the resolver
 * (src/lib/games/resolver.ts) or the registry (src/lib/games/all-games.ts).
 * Until registration, `resolveGameConfig('game3')` throws `Unknown game`.
 *
 * When implementing the real Game 3:
 *   1. Replace all placeholder values below with real ones.
 *   2. Register in resolver.ts (add a 'case "game3"' branch) and
 *      all-games.ts (add an entry to ALL_GAMES).
 *   3. Add the game ID to VALID_GAMES in src/params/game.ts.
 *   4. Follow the full checklist in docs/adding-a-new-game.md.
 */

import type { GameConfig } from '../types';
import { extractGame3CardNumber } from './extract';
import { game3Theme } from './theme';
import { game3NavItems, game3ProtectedRoutes } from './nav';
import { BOBA_SCAN_CONFIG, BOBA_PIPELINE_CONFIG } from '$lib/data/boba-config';

const game3Config: GameConfig = {
	// ── Identity ────────────────────────────────────────────────
	id: 'game3',
	name: 'Game 3 (placeholder)',
	shortName: 'Game3',
	icon: '🎴',

	// ── Card Number Extraction ─────────────────────────────────
	extractCardNumber: extractGame3CardNumber,

	// ── Config Bundles ─────────────────────────────────────────
	// Safety limits (file size, pixel bomb protection, blur threshold) are
	// game-agnostic — reuse BoBA values until Game 3 has tuned defaults.
	scanConfig: BOBA_SCAN_CONFIG,
	pipelineConfig: BOBA_PIPELINE_CONFIG,

	// ── eBay Integration ───────────────────────────────────────
	ebaySearchKeywords: ['Game 3'],

	// ── Theme ──────────────────────────────────────────────────
	theme: game3Theme,

	// ── Navigation ─────────────────────────────────────────────
	navItems: game3NavItems,
	protectedRoutes: game3ProtectedRoutes,
};

export default game3Config;
