/**
 * Wonders of The First — visual theme.
 *
 * The core GameTheme fields conform to the interface in ../types.ts.
 * Wonders-specific extras (CSS custom properties bundle, orbital color
 * map) are exported separately so the GameConfig interface stays stable.
 */

import type { GameTheme } from '../types';

export const wondersTheme: GameTheme = {
	accentPrimary: '#3B82F6',     // Blue (Thalwind orbital)
	accentSecondary: '#D4AF37',   // Gold (premium/fantasy feel)
	cardBg: '#0A1628',            // Deep navy
	textAccent: '#60A5FA',        // Light blue
};

/** CSS custom properties to apply when in a Wonders-scoped route. */
export const wondersCssVars: Record<string, string> = {
	'--game-accent-primary': '#3B82F6',
	'--game-accent-secondary': '#D4AF37',
	'--game-card-bg': '#0A1628',
	'--game-text-accent': '#60A5FA',
	'--game-gradient-start': '#0A1628',
	'--game-gradient-end': '#1E3A5F',
};

/** Orbital color map for card type indicators and metadata badges. */
export const wondersOrbitalColors: Record<string, string> = {
	petraia: '#22C55E',    // Green — Nature
	thalwind: '#3B82F6',   // Blue — Air
	solfera: '#EF4444',    // Red — Fire
	heliosynth: '#EAB308', // Yellow — Tech
	umbrathene: '#A855F7', // Purple — Dark
	boundless: '#F5F5F5',  // Gray — Cosmic
	first: '#F59E0B',      // Amber — The First
};
