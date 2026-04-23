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
import { extractCardNumber } from './extract';
import { bobaTheme } from './theme';
import { bobaNavItems, bobaProtectedRoutes } from './nav';
import {
	BOBA_SCAN_CONFIG,
	BOBA_PIPELINE_CONFIG,
} from '$lib/data/boba-config';

const bobaConfig: GameConfig = {
	// ── Identity ────────────────────────────────────────────────
	id: 'boba',
	name: 'Bo Jackson Battle Arena',
	shortName: 'BoBA',
	icon: '🏈',

	// ── Card Number Extraction ─────────────────────────────────
	extractCardNumber,

	// ── Config Bundles ─────────────────────────────────────────
	scanConfig: BOBA_SCAN_CONFIG,
	pipelineConfig: BOBA_PIPELINE_CONFIG,

	// ── eBay Integration ───────────────────────────────────────
	ebaySearchKeywords: ['BoBA', 'Bo Jackson Battle Arena', 'BOBA card'],

	// ── Theme ──────────────────────────────────────────────────
	theme: bobaTheme,

	// ── Navigation ─────────────────────────────────────────────
	navItems: bobaNavItems,
	protectedRoutes: bobaProtectedRoutes,
};

export default bobaConfig;
