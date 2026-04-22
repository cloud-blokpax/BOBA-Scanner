/**
 * Parallel utilities — short codes, full names, colors, grouping.
 *
 * Used by ScanConfirmation (parallel selector), CardDetail (parallel badge +
 * selector), the collection grid (thumbnails), and the eBay/Whatnot listing
 * builders.
 *
 * The DATABASE stores the full names (e.g. "Classic Foil"). These short codes
 * are an internal-only UI helper.
 */

import type { WondersParallelCode, WondersParallelName } from './wonders-parallels';
import { WONDERS_PARALLEL_CODE_TO_NAME } from './wonders-parallels';

export const PARALLEL_CODES = ['paper', 'cf', 'ff', 'ocm', 'sf'] as const;
export type ParallelCode = WondersParallelCode;

/** Short abbreviation used on badges and thumbnails. */
export const PARALLEL_ABBREV: Record<ParallelCode, string> = {
	paper: 'P',
	cf: 'CF',
	ff: 'FF',
	ocm: 'OCM',
	sf: 'SF'
};

/** Full display name used in card detail, listings, and titles. Matches DB values. */
export const PARALLEL_FULL_NAME: Record<ParallelCode, WondersParallelName> =
	WONDERS_PARALLEL_CODE_TO_NAME;

/** Accent color per parallel (hex) — for badges and pills. */
export const PARALLEL_COLOR: Record<ParallelCode, string> = {
	paper: '#94a3b8',  // slate-400 — neutral
	cf: '#22d3ee',     // cyan-400 — foil shimmer
	ff: '#a78bfa',     // violet-400 — borderless/special
	ocm: '#f59e0b',    // amber-500 — numbered
	sf: '#f43f5e'      // rose-500 — 1/1 rarity
};

/** The foil parallels grouped together in the UI filter. */
export const FOIL_PARALLELS: readonly ParallelCode[] = ['cf', 'ff', 'ocm', 'sf'] as const;

/**
 * Normalize an arbitrary value to a ParallelCode, defaulting to 'paper'.
 *
 * Accepts the short codes (`cf`, `ff`...), the legacy long-form aliases
 * (`classic_foil`, `formless_foil`...), AND the human-readable DB names
 * (`Paper`, `Classic Foil`, `Formless Foil`, `Orbital Color Match`,
 * `Stonefoil`). Anything unrecognized maps to `paper`.
 */
export function normalizeParallel(raw: unknown): ParallelCode {
	if (typeof raw !== 'string') return 'paper';
	const lower = raw.trim().toLowerCase();
	// Short codes
	if ((PARALLEL_CODES as readonly string[]).includes(lower)) return lower as ParallelCode;
	// Legacy long-form aliases and DB names (case-insensitive)
	if (lower === 'classic_foil' || lower === 'classic foil') return 'cf';
	if (lower === 'formless_foil' || lower === 'formless foil') return 'ff';
	if (lower === 'orbital_color_match' || lower === 'orbital color match') return 'ocm';
	if (lower === 'stone_foil' || lower === 'stonefoil' || lower === 'stone foil') return 'sf';
	if (lower === 'paper') return 'paper';
	if (lower === 'unknown') return 'paper';
	return 'paper';
}

/** True when the parallel is a foil treatment (cf, ff, ocm, sf). */
export function isFoilParallel(parallel: string | null | undefined): boolean {
	if (!parallel) return false;
	return (FOIL_PARALLELS as readonly string[]).includes(normalizeParallel(parallel));
}
