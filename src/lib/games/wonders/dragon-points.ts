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

import type { VariantCode } from '$lib/data/variants';
import { normalizeVariant } from '$lib/data/variants';

// ── Types ────────────────────────────────────────────────────

export type DragonRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'mythic';

export interface DragonPointsInput {
	rarity: string | null;
	variant: string;
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
 * Subset of VariantCode representing foil variants eligible for Dragon Points.
 * Paper is explicitly excluded — it earns zero points by design.
 */
type FoilVariant = Exclude<VariantCode, 'paper'>;

// ── Hardcoded fallback base table ────────────────────────────
// The admin config table (dragon_points_config) overrides this at runtime
// via loadDragonPointsConfig() + calculateDragonPointsWithConfig(). When
// the config table is missing or has gaps, the calculator falls back to
// these values so it always produces a defensible result.

const DRAGON_POINTS_BASE_TABLE: Record<DragonRarity, Record<FoilVariant, number>> = {
	common:   { cf: 1, ff: 2,  ocm: 10, sf: 100 },
	uncommon: { cf: 2, ff: 3,  ocm: 15, sf: 150 },
	rare:     { cf: 3, ff: 4,  ocm: 20, sf: 200 },
	epic:     { cf: 4, ff: 5,  ocm: 25, sf: 250 },
	mythic:   { cf: 7, ff: 15, ocm: 75, sf: 500 },
};

/** 2026 freshness bonus — 35% additive over base. */
const FRESHNESS_YEAR = 2026;
const FRESHNESS_MULTIPLIER = 1.35;

/** Class multiplier for Stoneseekers and Lore Mythics — 3× after freshness. */
const CLASS_MULTIPLIER = 3.0;

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

	// Rule 1: Paper variants earn zero points — the system exists to reward foils.
	const variant = normalizeVariant(input.variant);
	if (variant === 'paper') {
		return {
			points: 0,
			breakdown: emptyBreakdown,
			disqualification_reason: 'Paper variant earns no Dragon Points',
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
	// (variant is guaranteed to be a foil here — paper was rejected in Rule 1)
	const base = DRAGON_POINTS_BASE_TABLE[rawRarity][variant as FoilVariant];

	// Freshness bonus: 35% over base for 2026 cards
	const isFresh = input.year === FRESHNESS_YEAR;
	const afterFreshness = isFresh ? base * FRESHNESS_MULTIPLIER : base;
	const freshnessBonus = afterFreshness - base;

	// Class multiplier: 3× for Stoneseekers and Lore Mythics.
	// The input provides explicit booleans; if missing, derive from card_class.
	const isStoneseeker =
		input.is_stoneseeker ?? containsInsensitive(input.card_class, 'stoneseeker');
	const isLoreMythic =
		input.is_lore_mythic ?? (rawRarity === 'mythic' && containsInsensitive(input.card_class, 'lore'));
	const appliesClassMult = isStoneseeker || isLoreMythic;

	const afterClassMult = appliesClassMult ? afterFreshness * CLASS_MULTIPLIER : afterFreshness;
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
	baseTable: DRAGON_POINTS_BASE_TABLE,
	freshnessYear: FRESHNESS_YEAR,
	freshnessMultiplier: FRESHNESS_MULTIPLIER,
	classMultiplier: CLASS_MULTIPLIER,
	/** Dragon Gold eligibility threshold — 15,000 points. */
	dragonGoldThreshold: 15000,
} as const;
