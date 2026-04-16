/**
 * Variant utilities — variant codes, full names, colors, grouping.
 *
 * Used by ScanConfirmation (variant selector), CardDetail (variant badge +
 * selector), the collection grid (thumbnails), and the eBay/Whatnot listing
 * builders.
 */

export const VARIANT_CODES = ['paper', 'cf', 'ff', 'ocm', 'sf'] as const;
export type VariantCode = typeof VARIANT_CODES[number];

/** Short abbreviation used on badges and thumbnails. */
export const VARIANT_ABBREV: Record<VariantCode, string> = {
	paper: 'P',
	cf: 'CF',
	ff: 'FF',
	ocm: 'OCM',
	sf: 'SF',
};

/** Full display name used in card detail, listings, and titles. */
export const VARIANT_FULL_NAME: Record<VariantCode, string> = {
	paper: 'Paper',
	cf: 'Classic Foil',
	ff: 'Formless Foil',
	ocm: 'Orbital Color Match',
	sf: 'Stone Foil',
};

/** Accent color per variant (hex) — for badges and pills. */
export const VARIANT_COLOR: Record<VariantCode, string> = {
	paper: '#94a3b8',  // slate-400 — neutral
	cf: '#22d3ee',     // cyan-400 — foil shimmer
	ff: '#a78bfa',     // violet-400 — borderless/special
	ocm: '#f59e0b',    // amber-500 — numbered
	sf: '#f43f5e',     // rose-500 — 1/1 rarity
};

/** The foil variants grouped together in the UI filter. */
export const FOIL_VARIANTS: readonly VariantCode[] = ['cf', 'ff', 'ocm', 'sf'] as const;

/** Normalize an arbitrary value to a VariantCode, defaulting to 'paper'. */
export function normalizeVariant(raw: unknown): VariantCode {
	if (typeof raw !== 'string') return 'paper';
	const lower = raw.toLowerCase();
	// Short codes (new)
	if ((VARIANT_CODES as readonly string[]).includes(lower)) return lower as VariantCode;
	// Legacy long-form aliases
	if (lower === 'classic_foil') return 'cf';
	if (lower === 'formless_foil') return 'ff';
	if (lower === 'stone_foil') return 'sf';
	if (lower === 'unknown') return 'paper';
	return 'paper';
}

/** True when the variant is a foil treatment (cf, ff, ocm, sf). */
export function isFoilVariant(variant: string | null | undefined): boolean {
	if (!variant) return false;
	return (FOIL_VARIANTS as readonly string[]).includes(variant);
}
