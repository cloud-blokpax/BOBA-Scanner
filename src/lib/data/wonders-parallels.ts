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

/**
 * Throw loudly if a short classifier code ever reaches a DB-write boundary.
 *
 * Short codes (`paper`|`cf`|`ff`|`ocm`|`sf`|`unknown`) are INTERNAL to the
 * classifier. Every persistence path must map them to the human-readable
 * name via `toParallelName()` (or `WONDERS_PARALLEL_NAMES`) before writing.
 * Reaching this assert means some upstream mapping was skipped.
 *
 * BoBA parallel values (e.g. "Battlefoil", "RAD") are free-text human names
 * and pass through unchallenged.
 *
 * @param parallel - value about to be persisted
 * @param context - free-form label for the error message (e.g. "scan-writer/final_parallel")
 */
export function assertHumanReadableParallel(
	parallel: string | null | undefined,
	context: string
): void {
	if (!parallel) return;
	if (/^(paper|cf|ff|ocm|sf|unknown)$/i.test(parallel)) {
		throw new Error(
			`Short parallel code leaked at ${context}: parallel="${parallel}". ` +
				`Expected human-readable name (e.g. "Paper", "Classic Foil", "Stonefoil"). ` +
				`Map the classifier output via toParallelName() / WONDERS_PARALLEL_NAMES before persisting.`
		);
	}
}

/**
 * Non-throwing variant: map a short code to its human-readable name if it
 * looks like a short code; return the input unchanged otherwise. Use at
 * soft persistence boundaries where a throw would lose data we'd rather
 * just correct silently (with a warn).
 */
export function coerceHumanReadableParallel(
	parallel: string | null | undefined,
	context: string
): string | null {
	if (!parallel) return null;
	const mapped = toParallelName(parallel.toLowerCase());
	if (mapped && mapped !== parallel) {
		console.warn(
			`[coerceHumanReadableParallel] Short code coerced at ${context}: "${parallel}" → "${mapped}"`
		);
		return mapped;
	}
	return parallel;
}

/**
 * Aliases Claude may emit that need normalizing to human-readable names.
 *
 * The classifier short codes (`cf`, `ff`, `ocm`, `sf`, `paper`) are already
 * covered by `WONDERS_PARALLEL_CODE_TO_NAME`. These additional entries
 * handle Claude's occasional long-form variants:
 *
 *   - 'classic_foil' / 'formless_foil' / 'stone_foil' — snake_case from
 *     older tool-use prompts. Kept here so we don't have to retrain Claude
 *     to match one canonical spelling.
 *   - 'stonefoil' — lowercase canonical (Stonefoil is one word).
 *   - 'orbital_color_match' — snake_case of the full name.
 *
 * BoBA values (e.g. "battlefoil", "rad") pass through unchanged — the
 * downstream `cards.parallel` lookup fixes them to canonical names via
 * prefix-derivation on ingest.
 */
const WONDERS_PARALLEL_ALIASES: Record<string, WondersParallelName> = {
	classic_foil: 'Classic Foil',
	formless_foil: 'Formless Foil',
	stone_foil: 'Stonefoil',
	stonefoil: 'Stonefoil',
	orbital_color_match: 'Orbital Color Match'
};

/**
 * Normalize an arbitrary parallel string (short code, long-form alias, or
 * anything else) to a human-readable name if possible, or pass through
 * unchanged.
 *
 * Used at the /api/scan Tier 3 boundary where Claude's output needs to be
 * coerced before the payload reaches the client. Client-side code uses
 * `toParallelName` + `coerceHumanReadableParallel` directly.
 */
export function normalizeParallelForServer(input: string): string {
	const lower = input.toLowerCase();
	return (
		WONDERS_PARALLEL_CODE_TO_NAME[lower as WondersParallelCode] ??
		WONDERS_PARALLEL_ALIASES[lower] ??
		input
	);
}
