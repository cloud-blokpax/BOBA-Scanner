/**
 * Unit tests for the Dragon Points calculator.
 *
 * Covers the full base table (rarity × variant), the 2026 freshness bonus,
 * the 3× Stoneseeker / Lore Mythic multiplier, combined stacking, and all
 * disqualification paths. Paper variant, unknown/empty rarity, token/tracker
 * types, and unrecognized rarities must return points=0 with a reason.
 */

import { describe, it, expect } from 'vitest';
import { calculateDragonPoints, DRAGON_POINTS_CONFIG } from '../src/lib/games/wonders/dragon-points';

describe('Dragon Points — base table (rarity × variant)', () => {
	// ── Common ───────────────────────────────────────────
	it('Common CF → 1', () => {
		const r = calculateDragonPoints({ rarity: 'common', parallel: 'cf', year: null, card_class: null });
		expect(r.points).toBe(1);
		expect(r.breakdown.base).toBe(1);
	});
	it('Common FF → 2', () => {
		const r = calculateDragonPoints({ rarity: 'common', parallel: 'ff', year: null, card_class: null });
		expect(r.points).toBe(2);
	});
	it('Common OCM → 10', () => {
		const r = calculateDragonPoints({ rarity: 'common', parallel: 'ocm', year: null, card_class: null });
		expect(r.points).toBe(10);
	});
	it('Common SF → 100', () => {
		const r = calculateDragonPoints({ rarity: 'common', parallel: 'sf', year: null, card_class: null });
		expect(r.points).toBe(100);
	});

	// ── Uncommon ─────────────────────────────────────────
	it('Uncommon CF → 2', () => {
		const r = calculateDragonPoints({ rarity: 'uncommon', parallel: 'cf', year: null, card_class: null });
		expect(r.points).toBe(2);
	});
	it('Uncommon FF → 3', () => {
		const r = calculateDragonPoints({ rarity: 'uncommon', parallel: 'ff', year: null, card_class: null });
		expect(r.points).toBe(3);
	});
	it('Uncommon OCM → 15', () => {
		const r = calculateDragonPoints({ rarity: 'uncommon', parallel: 'ocm', year: null, card_class: null });
		expect(r.points).toBe(15);
	});
	it('Uncommon SF → 150', () => {
		const r = calculateDragonPoints({ rarity: 'uncommon', parallel: 'sf', year: null, card_class: null });
		expect(r.points).toBe(150);
	});

	// ── Rare ─────────────────────────────────────────────
	it('Rare CF → 3', () => {
		const r = calculateDragonPoints({ rarity: 'rare', parallel: 'cf', year: null, card_class: null });
		expect(r.points).toBe(3);
	});
	it('Rare FF → 4', () => {
		const r = calculateDragonPoints({ rarity: 'rare', parallel: 'ff', year: null, card_class: null });
		expect(r.points).toBe(4);
	});
	it('Rare OCM → 20', () => {
		const r = calculateDragonPoints({ rarity: 'rare', parallel: 'ocm', year: null, card_class: null });
		expect(r.points).toBe(20);
	});
	it('Rare SF → 200', () => {
		const r = calculateDragonPoints({ rarity: 'rare', parallel: 'sf', year: null, card_class: null });
		expect(r.points).toBe(200);
	});

	// ── Epic ─────────────────────────────────────────────
	it('Epic CF → 4', () => {
		const r = calculateDragonPoints({ rarity: 'epic', parallel: 'cf', year: null, card_class: null });
		expect(r.points).toBe(4);
	});
	it('Epic SF → 250', () => {
		const r = calculateDragonPoints({ rarity: 'epic', parallel: 'sf', year: null, card_class: null });
		expect(r.points).toBe(250);
	});

	// ── Mythic ───────────────────────────────────────────
	it('Mythic CF → 7', () => {
		const r = calculateDragonPoints({ rarity: 'mythic', parallel: 'cf', year: null, card_class: null });
		expect(r.points).toBe(7);
	});
	it('Mythic FF → 15', () => {
		const r = calculateDragonPoints({ rarity: 'mythic', parallel: 'ff', year: null, card_class: null });
		expect(r.points).toBe(15);
	});
	it('Mythic OCM → 75', () => {
		const r = calculateDragonPoints({ rarity: 'mythic', parallel: 'ocm', year: null, card_class: null });
		expect(r.points).toBe(75);
	});
	it('Mythic SF → 500', () => {
		const r = calculateDragonPoints({ rarity: 'mythic', parallel: 'sf', year: null, card_class: null });
		expect(r.points).toBe(500);
	});
});

describe('Dragon Points — 2026 freshness bonus (× 1.35)', () => {
	it('Mythic CF 2026 → floor(7 × 1.35) = 9', () => {
		const r = calculateDragonPoints({ rarity: 'mythic', parallel: 'cf', year: 2026, card_class: null });
		expect(r.points).toBe(9);
		expect(r.breakdown.base).toBe(7);
		// freshness_bonus carries the absolute added value
		expect(r.breakdown.freshness_bonus).toBeCloseTo(2.45, 2);
	});
	it('Mythic OCM 2026 → floor(75 × 1.35) = 101', () => {
		const r = calculateDragonPoints({ rarity: 'mythic', parallel: 'ocm', year: 2026, card_class: null });
		expect(r.points).toBe(101);
	});
	it('2025 card does NOT get freshness bonus', () => {
		const r = calculateDragonPoints({ rarity: 'mythic', parallel: 'ocm', year: 2025, card_class: null });
		expect(r.points).toBe(75);
		expect(r.breakdown.freshness_bonus).toBe(0);
	});
	it('null year does NOT get freshness bonus', () => {
		const r = calculateDragonPoints({ rarity: 'mythic', parallel: 'ocm', year: null, card_class: null });
		expect(r.points).toBe(75);
	});
});

describe('Dragon Points — Stoneseeker multiplier (× 3)', () => {
	it('Stoneseeker Mythic OCM 2026 → floor(75 × 1.35 × 3) = 303', () => {
		const r = calculateDragonPoints({
			rarity: 'mythic',
			parallel: 'ocm',
			year: 2026,
			card_class: 'Stoneseeker Wonder',
		});
		expect(r.points).toBe(303);
		expect(r.breakdown.base).toBe(75);
	});
	it('Stoneseeker Mythic OCM 2025 → 75 × 3 = 225', () => {
		const r = calculateDragonPoints({
			rarity: 'mythic',
			parallel: 'ocm',
			year: 2025,
			card_class: 'Stoneseeker Wonder',
		});
		expect(r.points).toBe(225);
	});
	it('Stoneseeker Rare CF 2025 → 3 × 3 = 9', () => {
		const r = calculateDragonPoints({
			rarity: 'rare',
			parallel: 'cf',
			year: 2025,
			card_class: 'Stoneseeker',
		});
		expect(r.points).toBe(9);
	});
	it('explicit is_stoneseeker flag takes precedence over card_class derivation', () => {
		const r = calculateDragonPoints({
			rarity: 'epic',
			parallel: 'ff',
			year: null,
			card_class: 'Goat Fighter',
			is_stoneseeker: true,
		});
		// Epic FF base = 5; × 3 = 15
		expect(r.points).toBe(15);
	});
});

describe('Dragon Points — Lore Mythic multiplier (× 3)', () => {
	it('Lore Mythic SF 2026 → floor(500 × 1.35 × 3) = 2025', () => {
		const r = calculateDragonPoints({
			rarity: 'mythic',
			parallel: 'sf',
			year: 2026,
			card_class: 'Lore Wonder',
		});
		expect(r.points).toBe(2025);
	});
	it('Lore on non-Mythic does NOT get the class multiplier', () => {
		const r = calculateDragonPoints({
			rarity: 'rare',
			parallel: 'ocm',
			year: null,
			card_class: 'Lore Wonder',
		});
		// Rare OCM = 20, no multiplier
		expect(r.points).toBe(20);
	});
});

describe('Dragon Points — disqualifications', () => {
	it('Paper parallel → 0 with reason', () => {
		const r = calculateDragonPoints({ rarity: 'mythic', parallel: 'paper', year: 2026, card_class: null });
		expect(r.points).toBe(0);
		expect(r.disqualification_reason).toMatch(/Paper parallel earns no Dragon Points/);
	});
	it('Empty rarity → 0 with "flag for manual correction" reason', () => {
		const r = calculateDragonPoints({ rarity: '', parallel: 'ocm', year: null, card_class: null });
		expect(r.points).toBe(0);
		expect(r.disqualification_reason).toMatch(/flag for manual correction/);
	});
	it('Null rarity → 0 with "flag for manual correction" reason', () => {
		const r = calculateDragonPoints({ rarity: null, parallel: 'ocm', year: null, card_class: null });
		expect(r.points).toBe(0);
		expect(r.disqualification_reason).toMatch(/flag for manual correction/);
	});
	it('Token rarity → 0', () => {
		const r = calculateDragonPoints({ rarity: 'token', parallel: 'ocm', year: null, card_class: null });
		expect(r.points).toBe(0);
		expect(r.disqualification_reason).toMatch(/not eligible/);
	});
	it('Promo rarity → 0 with "bonus card values TBD" reason', () => {
		const r = calculateDragonPoints({ rarity: 'promo', parallel: 'ff', year: null, card_class: null });
		expect(r.points).toBe(0);
		expect(r.disqualification_reason).toMatch(/bonus card/i);
	});
	it('Unrecognized rarity string → 0 with specific reason', () => {
		const r = calculateDragonPoints({ rarity: 'legendary', parallel: 'ocm', year: null, card_class: null });
		expect(r.points).toBe(0);
		expect(r.disqualification_reason).toMatch(/Unrecognized rarity/);
	});
});

describe('Dragon Points — conservative rounding + config', () => {
	it('Uses Math.floor for the final step (never rounds up)', () => {
		// Epic OCM 2026 = 25 × 1.35 = 33.75 → floor = 33
		const r = calculateDragonPoints({ rarity: 'epic', parallel: 'ocm', year: 2026, card_class: null });
		expect(r.points).toBe(33);
	});
	it('Exposes DRAGON_POINTS_CONFIG for admin UI introspection', () => {
		expect(DRAGON_POINTS_CONFIG.dragonGoldThreshold).toBe(15000);
		expect(DRAGON_POINTS_CONFIG.freshnessYear).toBe(2026);
		expect(DRAGON_POINTS_CONFIG.freshnessMultiplier).toBe(1.35);
		expect(DRAGON_POINTS_CONFIG.classMultiplier).toBe(3.0);
	});
	it('Breakdown fields sum to the reported final value (accounting for floor)', () => {
		const r = calculateDragonPoints({
			rarity: 'mythic',
			parallel: 'ocm',
			year: 2026,
			card_class: 'Stoneseeker',
		});
		// final = floor(base + freshness_bonus + class_multiplier)
		const expected = Math.floor(
			r.breakdown.base + r.breakdown.freshness_bonus + r.breakdown.class_multiplier
		);
		expect(r.breakdown.final).toBe(expected);
	});
});
