/**
 * Dragon Power Points calculator — Wonders of The First.
 *
 * The Dragon Points system rewards foil collecting toward the 15,000-point
 * Dragon Gold eligibility threshold. Paper variants earn zero points (the
 * system exists to reward foils specifically). Stacking order is critical
 * and auditable via the returned breakdown:
 *
 *     base → freshness bonus (if 2026) → class multiplier (Stoneseeker / Lore Mythic)
 *
 * Conservative rounding (Math.floor) is used at the final step so we never
 * over-report points — overestimation could mislead users into believing
 * they've qualified for Dragon Gold when they haven't.
 */

import type { ParallelCode } from '$lib/data/parallels';
import { normalizeParallel } from '$lib/data/parallels';

// ── Types ────────────────────────────────────────────────────

export type DragonRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'mythic';

export interface DragonPointsInput {
	rarity: string | null;
	/** Parallel — accepts either a short code (`cf`) or a human-readable DB
	 *  name (`Classic Foil`). Internally normalized to the short code. */
	parallel: string;
	year: number | null;
	card_class: string | null;
	/** Derived flag — true when card_class contains "Stoneseeker" (3× multiplier). */
	is_stoneseeker?: boolean;
	/** Derived flag — true when card_class contains "Lore" AND rarity === 'mythic' (3× multiplier). */
	is_lore_mythic?: boolean;
}

export interface DragonPointsBreakdown {
	base: number;
	freshness_bonus: number;
	class_multiplier: number;
	final: number;
}

export interface DragonPointsResult {
	points: number;
	breakdown: DragonPointsBreakdown;
	/** When points === 0, explains why. Undefined when the card earned points. */
	disqualification_reason?: string;
}

/**
 * Subset of ParallelCode representing foil parallels eligible for Dragon Points.
 * Paper is explicitly excluded — it earns zero points by design.
 */
type FoilParallel = Exclude<ParallelCode, 'paper'>;

// ── Hardcoded fallback base table ────────────────────────────
// The admin config table (dragon_points_config) overrides these at runtime
// via setDragonPointsConfig(). When the config table is missing or has
// gaps, the calculator falls back to these values so it always produces
// a defensible result.

const DEFAULT_BASE_TABLE: Record<DragonRarity, Record<FoilParallel, number>> = {
	common:   { cf: 1, ff: 2,  ocm: 10, sf: 100 },
	uncommon: { cf: 2, ff: 3,  ocm: 15, sf: 150 },
	rare:     { cf: 3, ff: 4,  ocm: 20, sf: 200 },
	epic:     { cf: 4, ff: 5,  ocm: 25, sf: 250 },
	mythic:   { cf: 7, ff: 15, ocm: 75, sf: 500 },
};

/** Default 2026 freshness bonus — 35% additive over base. */
const DEFAULT_FRESHNESS_YEAR = 2026;
const DEFAULT_FRESHNESS_MULTIPLIER = 1.35;

/** Default class multiplier for Stoneseekers and Lore Mythics. */
const DEFAULT_CLASS_MULTIPLIER = 3.0;

// ── Runtime-mutable config (admin overrides) ──────────────────
// setDragonPointsConfig() writes to these module-level refs. The
// calculator reads via getEffectiveConfig() at call time so admin
// edits take effect immediately for all callers.

let _baseTable: Record<DragonRarity, Record<FoilParallel, number>> = DEFAULT_BASE_TABLE;
let _freshnessYear: number = DEFAULT_FRESHNESS_YEAR;
let _freshnessMultiplier: number = DEFAULT_FRESHNESS_MULTIPLIER;
let _classMultiplier: number = DEFAULT_CLASS_MULTIPLIER;

export interface DragonPointsConfigOverrides {
	/** Partial override — keys that aren't provided keep the hardcoded defaults. */
	baseTable?: Partial<Record<DragonRarity, Partial<Record<FoilParallel, number>>>>;
	freshnessYear?: number;
	freshnessMultiplier?: number;
	classMultiplier?: number;
}

/**
 * Apply admin config overrides to the calculator.
 * Call this once on page load after fetching from the dragon_points_config table.
 * Passing `null` or an empty object resets to hardcoded defaults.
 */
export function setDragonPointsConfig(overrides: DragonPointsConfigOverrides | null): void {
	if (!overrides) {
		_baseTable = DEFAULT_BASE_TABLE;
		_freshnessYear = DEFAULT_FRESHNESS_YEAR;
		_freshnessMultiplier = DEFAULT_FRESHNESS_MULTIPLIER;
		_classMultiplier = DEFAULT_CLASS_MULTIPLIER;
		return;
	}
	// Deep-merge base table so admin config can override just one cell.
	if (overrides.baseTable) {
		const merged: Record<DragonRarity, Record<FoilParallel, number>> = JSON.parse(
			JSON.stringify(DEFAULT_BASE_TABLE)
		);
		for (const [rarity, row] of Object.entries(overrides.baseTable)) {
			if (!isDragonRarity(rarity) || !row) continue;
			for (const [parallel, value] of Object.entries(row)) {
				if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
					merged[rarity][parallel as FoilParallel] = value;
				}
			}
		}
		_baseTable = merged;
	}
	if (typeof overrides.freshnessYear === 'number') _freshnessYear = overrides.freshnessYear;
	if (typeof overrides.freshnessMultiplier === 'number' && overrides.freshnessMultiplier > 0) {
		_freshnessMultiplier = overrides.freshnessMultiplier;
	}
	if (typeof overrides.classMultiplier === 'number' && overrides.classMultiplier > 0) {
		_classMultiplier = overrides.classMultiplier;
	}
}

/** Get the currently effective config (merged defaults + overrides). */
export function getEffectiveDragonPointsConfig() {
	return {
		baseTable: _baseTable,
		freshnessYear: _freshnessYear,
		freshnessMultiplier: _freshnessMultiplier,
		classMultiplier: _classMultiplier,
	};
}

// ── Main calculator ─────────────────────────────────────────

/**
 * Calculate Dragon Points for a single Wonders card with known variant.
 *
 * Stacking order (documented in the calculator JSDoc above):
 *   1. Base points from rarity × variant table
 *   2. Freshness bonus: × 1.35 for 2026 cards
 *   3. Class multiplier: × 3 for Stoneseekers and Lore Mythics
 *   4. Math.floor (conservative rounding toward user's benefit)
 *
 * Returns the breakdown so the UI can show users exactly where each
 * point came from — essential for a competitive progression system.
 */
export function calculateDragonPoints(input: DragonPointsInput): DragonPointsResult {
	const emptyBreakdown: DragonPointsBreakdown = {
		base: 0,
		freshness_bonus: 0,
		class_multiplier: 0,
		final: 0,
	};

	// Rule 1: Paper parallels earn zero points — the system exists to reward foils.
	const parallel = normalizeParallel(input.parallel);
	if (parallel === 'paper') {
		return {
			points: 0,
			breakdown: emptyBreakdown,
			disqualification_reason: 'Paper parallel earns no Dragon Points',
		};
	}

	// Rule 2: Unknown/empty rarity cannot be scored. Flag for manual correction.
	const rawRarity = (input.rarity || '').trim().toLowerCase();
	if (!rawRarity) {
		return {
			points: 0,
			breakdown: emptyBreakdown,
			disqualification_reason: 'Rarity unknown — flag for manual correction',
		};
	}

	// Rule 3: Token / tracker / promo types aren't in the base Dragon Cup table.
	// Promos are handled by the bonus card table (currently all zero pending the
	// PDF being finalized); tokens/trackers are not collectible in the Dragon
	// Cup sense and earn zero points.
	if (rawRarity === 'token' || rawRarity === 'tracker') {
		return {
			points: 0,
			breakdown: emptyBreakdown,
			disqualification_reason: 'Token/tracker cards are not eligible for Dragon Points',
		};
	}
	if (rawRarity === 'promo') {
		// Bonus card (promo) values are TBD pending the Dragon Cup PDF.
		// Return zero with a specific reason so the UI can disclose this state
		// rather than quietly scoring promos at zero as if they were disqualified.
		return {
			points: 0,
			breakdown: emptyBreakdown,
			disqualification_reason: 'Promo/bonus card point values not yet published',
		};
	}

	// Rule 4: rarity must be one of the 5 Dragon Cup tiers.
	if (!isDragonRarity(rawRarity)) {
		return {
			points: 0,
			breakdown: emptyBreakdown,
			disqualification_reason: `Unrecognized rarity "${rawRarity}"`,
		};
	}

	// ── Compute: base → freshness → class multiplier → floor ──
	// (parallel is guaranteed to be a foil here — paper was rejected in Rule 1)
	// Reads runtime config so admin overrides take effect immediately.
	const base = _baseTable[rawRarity][parallel as FoilParallel];

	// Freshness bonus: default 35% over base for 2026 cards
	const isFresh = input.year === _freshnessYear;
	const afterFreshness = isFresh ? base * _freshnessMultiplier : base;
	const freshnessBonus = afterFreshness - base;

	// Class multiplier: default 3× for Stoneseekers and Lore Mythics.
	// The input provides explicit booleans; if missing, derive from card_class.
	const isStoneseeker =
		input.is_stoneseeker ?? containsInsensitive(input.card_class, 'stoneseeker');
	const isLoreMythic =
		input.is_lore_mythic ?? (rawRarity === 'mythic' && containsInsensitive(input.card_class, 'lore'));
	const appliesClassMult = isStoneseeker || isLoreMythic;

	const afterClassMult = appliesClassMult ? afterFreshness * _classMultiplier : afterFreshness;
	const classMultAdded = afterClassMult - afterFreshness;

	// Conservative floor rounding — never over-report points.
	const finalPoints = Math.floor(afterClassMult);

	return {
		points: finalPoints,
		breakdown: {
			base,
			freshness_bonus: Number(freshnessBonus.toFixed(4)),
			class_multiplier: Number(classMultAdded.toFixed(4)),
			final: finalPoints,
		},
	};
}

// ── Helpers ──────────────────────────────────────────────────

function isDragonRarity(r: string): r is DragonRarity {
	return r === 'common' || r === 'uncommon' || r === 'rare' || r === 'epic' || r === 'mythic';
}

function containsInsensitive(haystack: string | null, needle: string): boolean {
	if (!haystack) return false;
	return haystack.toLowerCase().includes(needle.toLowerCase());
}

// ── Exports for admin config layer (Step 3.3) ────────────────

export const DRAGON_POINTS_CONFIG = {
	/** Compile-time default table (frozen). Runtime overrides come via setDragonPointsConfig. */
	baseTable: DEFAULT_BASE_TABLE,
	freshnessYear: DEFAULT_FRESHNESS_YEAR,
	freshnessMultiplier: DEFAULT_FRESHNESS_MULTIPLIER,
	classMultiplier: DEFAULT_CLASS_MULTIPLIER,
	/** Dragon Gold eligibility threshold — 15,000 points. */
	dragonGoldThreshold: 15000,
} as const;
