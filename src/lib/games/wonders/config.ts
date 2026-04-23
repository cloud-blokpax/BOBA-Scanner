/**
 * Wonders of The First — GameConfig implementation.
 *
 * Assembles all Wonders-specific modules (extract, prompt, theme, nav)
 * into a single GameConfig object. Shared scan/pipeline thresholds
 * mirror BoBA since the recognition pipeline is game-agnostic.
 */

import type { GameConfig } from '../types';
import { extractWondersCardNumber } from './extract';
import { wondersTheme } from './theme';
import { wondersNavItems, wondersProtectedRoutes } from './nav';
import {
	BOBA_SCAN_CONFIG,
	BOBA_PIPELINE_CONFIG,
} from '$lib/data/boba-config';

const wondersConfig: GameConfig = {
	// ── Identity ────────────────────────────────────────────────
	id: 'wonders',
	name: 'Wonders of The First',
	shortName: 'Wonders',
	icon: '🐉',

	// ── Card Number Extraction ─────────────────────────────────
	extractCardNumber: extractWondersCardNumber,

	// ── Config Bundles ─────────────────────────────────────────
	// Scan safety / quality limits are game-agnostic — reuse BoBA values.
	scanConfig: BOBA_SCAN_CONFIG,
	pipelineConfig: BOBA_PIPELINE_CONFIG,

	// ── eBay Integration ───────────────────────────────────────
	ebaySearchKeywords: ['Wonders of The First', 'WoTF', 'WOTF'],

	// ── Theme ──────────────────────────────────────────────────
	theme: wondersTheme,

	// ── Navigation ─────────────────────────────────────────────
	navItems: wondersNavItems,
	protectedRoutes: wondersProtectedRoutes,
};

export default wondersConfig;
