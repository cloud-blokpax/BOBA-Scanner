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

import type { GameConfig, OcrRegion } from '../types';
import { extractGame3CardNumber, GAME3_PREFIXES } from './extract';
import { GAME3_CARD_ID_TOOL, GAME3_SYSTEM_PROMPT, GAME3_USER_PROMPT } from './prompt';
import { game3Theme } from './theme';
import { game3NavItems, game3ProtectedRoutes } from './nav';
import { BOBA_SCAN_CONFIG, BOBA_PIPELINE_CONFIG } from '$lib/data/boba-config';

// OCR regions — placeholder full-card-bottom-strip. Replace with regions
// tuned to Game 3's actual card layout.
const GAME3_OCR_REGIONS: readonly OcrRegion[] = [
	{ x: 0.0, y: 0.82, w: 1.0, h: 0.16, label: 'placeholder-bottom-strip' },
] as const;

const game3Config: GameConfig = {
	// ── Identity ────────────────────────────────────────────────
	id: 'game3',
	name: 'Game 3 (placeholder)',
	shortName: 'Game3',
	icon: '🎴',

	// ── Card Number Extraction (Tier 2) ────────────────────────
	knownPrefixes: GAME3_PREFIXES,
	extractCardNumber: extractGame3CardNumber,

	// ── OCR Regions ────────────────────────────────────────────
	ocrRegions: GAME3_OCR_REGIONS,

	// ── Config Bundles ─────────────────────────────────────────
	// Safety limits (file size, pixel bomb protection, blur threshold) are
	// game-agnostic — reuse BoBA values until Game 3 has tuned defaults.
	scanConfig: BOBA_SCAN_CONFIG,
	pipelineConfig: BOBA_PIPELINE_CONFIG,

	// ── AI Identification (Tier 3) ─────────────────────────────
	claudeSystemPrompt: GAME3_SYSTEM_PROMPT,
	claudeUserPrompt: GAME3_USER_PROMPT,
	cardIdTool: GAME3_CARD_ID_TOOL,

	// ── eBay Integration ───────────────────────────────────────
	ebaySearchKeywords: ['Game 3'],

	// ── Theme ──────────────────────────────────────────────────
	theme: game3Theme,

	// ── Navigation ─────────────────────────────────────────────
	navItems: game3NavItems,
	protectedRoutes: game3ProtectedRoutes,
};

export default game3Config;
