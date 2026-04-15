/**
 * BoBA (Bo Jackson Battle Arena) — GameConfig implementation.
 *
 * Assembles all BoBA-specific modules (extract, prompt, theme, nav)
 * into a single GameConfig object that the game resolver returns.
 *
 * Config values for OCR regions, scan limits, and pipeline thresholds
 * are imported from src/lib/data/boba-config.ts (the existing source
 * of truth) to avoid duplicating constants.
 */

import type { GameConfig } from '../types';
import { KNOWN_PREFIXES, extractCardNumber } from './extract';
import { BOBA_CARD_ID_TOOL, BOBA_SYSTEM_PROMPT, BOBA_USER_PROMPT } from './prompt';
import { bobaTheme } from './theme';
import { bobaNavItems, bobaProtectedRoutes } from './nav';
import {
	BOBA_OCR_REGIONS,
	BOBA_SCAN_CONFIG,
	BOBA_PIPELINE_CONFIG,
} from '$lib/data/boba-config';

const bobaConfig: GameConfig = {
	// ── Identity ────────────────────────────────────────────────
	id: 'boba',
	name: 'Bo Jackson Battle Arena',
	shortName: 'BoBA',
	icon: '🏈',

	// ── Card Number Extraction (Tier 2) ────────────────────────
	knownPrefixes: KNOWN_PREFIXES,
	extractCardNumber,

	// ── OCR Regions ────────────────────────────────────────────
	ocrRegions: BOBA_OCR_REGIONS,

	// ── Config Bundles ─────────────────────────────────────────
	scanConfig: BOBA_SCAN_CONFIG,
	pipelineConfig: BOBA_PIPELINE_CONFIG,

	// ── AI Identification (Tier 3) ─────────────────────────────
	claudeSystemPrompt: BOBA_SYSTEM_PROMPT,
	claudeUserPrompt: BOBA_USER_PROMPT,
	cardIdTool: BOBA_CARD_ID_TOOL,

	// ── eBay Integration ───────────────────────────────────────
	ebaySearchKeywords: ['BoBA', 'Bo Jackson Battle Arena', 'BOBA card'],

	// ── Theme ──────────────────────────────────────────────────
	theme: bobaTheme,

	// ── Navigation ─────────────────────────────────────────────
	navItems: bobaNavItems,
	protectedRoutes: bobaProtectedRoutes,
};

export default bobaConfig;
