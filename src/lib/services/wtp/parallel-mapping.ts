/**
 * Wonders parallel → WTP treatment mapping.
 *
 * Wonders cards are stored with full human-readable parallel names in
 * `cards.parallel` ('Paper', 'Classic Foil', 'Formless Foil',
 * 'Orbital Color Match', 'Stonefoil'). WTP's listing API uses its own
 * vocabulary for the same physical printings.
 *
 * Returns null when the parallel doesn't map — composer surfaces this
 * as an "unmapped" warning and disables the submit button.
 */

const PARALLEL_TO_WTP_TREATMENT: Record<string, string> = {
	'Paper': 'paper',
	'paper': 'paper',
	'Classic Foil': 'classic_foil',
	'classic foil': 'classic_foil',
	'cf': 'classic_foil',
	'Formless Foil': 'formless_foil',
	'formless foil': 'formless_foil',
	'ff': 'formless_foil',
	'Orbital Color Match': 'orbital_color_match',
	'orbital color match': 'orbital_color_match',
	'ocm': 'orbital_color_match',
	'Stonefoil': 'stonefoil',
	'stonefoil': 'stonefoil',
	'Stone Foil': 'stonefoil',
	'stone foil': 'stonefoil',
	'sf': 'stonefoil'
};

export function parallelToWtpTreatment(parallel: string | null | undefined): string | null {
	if (!parallel) return null;
	return PARALLEL_TO_WTP_TREATMENT[parallel] ?? PARALLEL_TO_WTP_TREATMENT[parallel.toLowerCase()] ?? null;
}
