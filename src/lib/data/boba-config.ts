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

/**
 * Set Ascension Framework.
 *
 * Modern: Cards from the most recent 2 calendar years.
 * AlphaTrilogy: Cards from BoBA's first year (2024) only.
 * Hall of Fame: Cards released more than 2 full calendar years ago + all Alpha cards.
 *
 * Alpha Battlefoils are legal in all three formats.
 */

export interface SetRelease {
	setCode: string;
	name: string;
	releaseYear: number;
	isAlpha: boolean;
}

export const BOBA_SET_RELEASES: SetRelease[] = [
	{ setCode: 'alpha', name: 'Alpha Edition', releaseYear: 2024, isAlpha: true },
	{ setCode: 'alpha_update', name: 'Alpha Update', releaseYear: 2025, isAlpha: true },
	{ setCode: 'alpha_blast', name: 'Alpha Blast', releaseYear: 2025, isAlpha: true },
	{ setCode: 'griffey', name: '2026 Edition', releaseYear: 2026, isAlpha: false },
];

export type CompetitiveFormat = 'modern' | 'alpha_trilogy' | 'hall_of_fame';

/**
 * Determine which competitive formats a card's set is legal in.
 * Uses the current year to calculate ascension boundaries.
 */
export function getFormatLegality(setCode: string, currentYear?: number): CompetitiveFormat[] {
	const year = currentYear ?? new Date().getFullYear();
	const set = BOBA_SET_RELEASES.find(s => s.setCode === setCode);
	if (!set) return ['modern']; // Unknown sets default to Modern

	const formats: CompetitiveFormat[] = [];

	// Modern: released within the last 2 calendar years
	if (set.releaseYear >= year - 2) {
		formats.push('modern');
	}

	// AlphaTrilogy: Alpha-era cards only
	if (set.isAlpha) {
		formats.push('alpha_trilogy');
	}

	// Hall of Fame: released more than 2 full calendar years ago + all Alpha cards
	if (set.releaseYear < year - 2 || set.isAlpha) {
		formats.push('hall_of_fame');
	}

	// Alpha Battlefoils are a special bridge — legal everywhere
	// (handled at the card level, not set level, via parallel detection)

	return formats;
}

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
