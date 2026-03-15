/**
 * BOBA card game constants.
 *
 * Single source of truth for OCR regions, scan config, and card metadata.
 * Used by the recognition pipeline and UI components.
 */

export const BOBA_OCR_REGIONS = [
	{ x: 0.01, y: 0.84, w: 0.35, h: 0.13, label: 'bottom-left' },
	{ x: 0.60, y: 0.84, w: 0.35, h: 0.13, label: 'bottom-right' },
	{ x: 0.0, y: 0.80, w: 1.0, h: 0.18, label: 'full-strip' }
] as const;

export const BOBA_SCAN_CONFIG = {
	quality: 0.85,
	ocrConfidenceThreshold: 30,
	blurThreshold: 100,
	maxUploadSize: 1024,
	aiCostPerScan: 0.003,
	/** Maximum file size for API upload (bytes) */
	maxFileSize: 10_000_000,
	/** Maximum pixel count (pixel bomb protection) */
	maxPixels: 16_000_000,
	/** Allowed MIME types for card image uploads */
	allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp']
} as const;

export const BOBA_RARITIES = ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary'] as const;

import { WEAPON_HIERARCHY } from './boba-weapons';
export const BOBA_WEAPONS = WEAPON_HIERARCHY.map(w => w.name) as readonly string[];

export const BOBA_VARIANTS = ['base', 'foil', 'holographic', 'battlefoil', 'paper', 'inspired_ink'] as const;

export const BOBA_FIELD_DEFINITIONS = [
	{ key: 'card_number', label: 'Card Number', type: 'text' as const },
	{ key: 'hero_name', label: 'Hero Name', type: 'text' as const },
	{ key: 'athlete_name', label: 'Athlete Name', type: 'text' as const },
	{ key: 'set_code', label: 'Set', type: 'text' as const },
	{ key: 'power', label: 'Power', type: 'number' as const },
	{ key: 'rarity', label: 'Rarity', type: 'select' as const, options: [...BOBA_RARITIES] },
	{ key: 'weapon_type', label: 'Weapon', type: 'select' as const, options: [...BOBA_WEAPONS] },
	{ key: 'battle_zone', label: 'Battle Zone', type: 'text' as const },
	{ key: 'variant', label: 'Variant', type: 'select' as const, options: [...BOBA_VARIANTS] },
	{ key: 'parallel', label: 'Parallel', type: 'text' as const }
];
