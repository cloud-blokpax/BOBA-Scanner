/**
 * Wonders of The First — GameConfig implementation.
 *
 * Assembles all Wonders-specific modules (extract, prompt, theme, nav)
 * into a single GameConfig object. Shared scan/pipeline thresholds
 * mirror BoBA since the recognition pipeline is game-agnostic.
 */

import type { GameConfig, OcrRegion } from '../types';
import { extractWondersCardNumber, WONDERS_PREFIXES } from './extract';
import { wondersTheme } from './theme';
import { wondersNavItems, wondersProtectedRoutes } from './nav';
import {
	BOBA_SCAN_CONFIG,
	BOBA_PIPELINE_CONFIG,
} from '$lib/data/boba-config';

// ── OCR regions for Wonders card layout ────────────────────────
// Collector number sits at BOTTOM-LEFT; rarity at BOTTOM-RIGHT.
const WONDERS_OCR_REGIONS: readonly OcrRegion[] = [
	{ x: 0.03, y: 0.86, w: 0.45, h: 0.12, label: 'bottom-left-set-number' },
	{ x: 0.80, y: 0.88, w: 0.15, h: 0.10, label: 'bottom-right-rarity' },
	{ x: 0.0,  y: 0.82, w: 1.0,  h: 0.16, label: 'full-bottom-strip' },
] as const;

const wondersConfig: GameConfig = {
	// ── Identity ────────────────────────────────────────────────
	id: 'wonders',
	name: 'Wonders of The First',
	shortName: 'Wonders',
	icon: '🐉',

	// ── Card Number Extraction (Tier 2) ────────────────────────
	knownPrefixes: WONDERS_PREFIXES,
	extractCardNumber: extractWondersCardNumber,

	// ── OCR Regions ────────────────────────────────────────────
	ocrRegions: WONDERS_OCR_REGIONS,

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
