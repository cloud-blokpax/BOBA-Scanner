/**
 * Wonders parallel code↔name mapping.
 *
 * The parallel classifier emits short codes (`paper`, `cf`, `ff`, `ocm`, `sf`)
 * because they're compact identifiers for the visual rules that detected them.
 * The DATABASE stores HUMAN-READABLE names — every write path must map short
 * codes to full names via `toParallelName()` before the insert/update.
 *
 * Short codes are internal-only. The DB always stores `Paper`, `Classic Foil`,
 * `Formless Foil`, `Orbital Color Match`, or `Stonefoil`.
 */

export type WondersParallelCode = 'paper' | 'cf' | 'ff' | 'ocm' | 'sf';
export type WondersParallelName =
	| 'Paper'
	| 'Classic Foil'
	| 'Formless Foil'
	| 'Orbital Color Match'
	| 'Stonefoil';

export const WONDERS_PARALLEL_CODE_TO_NAME: Record<WondersParallelCode, WondersParallelName> = {
	paper: 'Paper',
	cf: 'Classic Foil',
	ff: 'Formless Foil',
	ocm: 'Orbital Color Match',
	sf: 'Stonefoil'
};

export const WONDERS_PARALLEL_NAME_TO_CODE: Record<WondersParallelName, WondersParallelCode> = {
	Paper: 'paper',
	'Classic Foil': 'cf',
	'Formless Foil': 'ff',
	'Orbital Color Match': 'ocm',
	Stonefoil: 'sf'
};

/** Map a classifier short code (e.g. "cf") to its DB name (e.g. "Classic Foil"). */
export function toParallelName(code: string | null | undefined): WondersParallelName | null {
	if (!code) return null;
	return (WONDERS_PARALLEL_CODE_TO_NAME as Record<string, WondersParallelName>)[code] ?? null;
}

/** Map a DB human-readable name (e.g. "Classic Foil") to a classifier short code. */
export function toParallelCode(name: string | null | undefined): WondersParallelCode | null {
	if (!name) return null;
	return (WONDERS_PARALLEL_NAME_TO_CODE as Record<string, WondersParallelCode>)[name] ?? null;
}
