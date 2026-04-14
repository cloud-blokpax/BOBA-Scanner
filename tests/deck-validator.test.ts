import { describe, it, expect, vi } from 'vitest';

// Mock dependencies that deck-validator imports
vi.mock('$lib/data/tournament-formats', async () => {
	const actual = await vi.importActual<typeof import('../src/lib/data/tournament-formats')>('../src/lib/data/tournament-formats');
	return actual;
});

vi.mock('$lib/data/boba-parallels', () => ({
	getParallel: () => null
}));

vi.mock('$lib/data/boba-dbs-scores', () => ({
	calculateTotalDbs: () => null
}));

vi.mock('$lib/data/boba-config', async () => {
	const actual = await vi.importActual<typeof import('../src/lib/data/boba-config')>('../src/lib/data/boba-config');
	return actual;
});

import { validateDeck } from '../src/lib/services/deck-validator';
import type { Card } from '../src/lib/types';

function makeCard(overrides: Partial<Card> = {}): Card {
	return {
		id: crypto.randomUUID(),
		name: 'Test Hero',
		hero_name: 'Test Hero',
		athlete_name: null,
		set_code: 'alpha',
		card_number: 'BF-1',
		parallel: null,
		power: 100,
		rarity: 'common',
		weapon_type: 'Fire',
		battle_zone: null,
		image_url: null,
		created_at: new Date().toISOString(),
		...overrides
	};
}

function makeHeroDeck(count: number, overrides: Partial<Card> = {}): Card[] {
	// Spread cards across 10 distinct power levels (max 6 per level, 60 cards / 10 = 6 each)
	const powerLevels = [55, 60, 65, 70, 80, 100, 110, 120, 130, 140];
	return Array.from({ length: count }, (_, i) =>
		makeCard({
			id: `card-${i}`,
			hero_name: `Hero ${i}`,
			card_number: `BF-${i}`,
			weapon_type: ['Fire', 'Ice', 'Steel'][i % 3],
			power: powerLevels[i % powerLevels.length],
			...overrides
		})
	);
}

function makeHotDogDeck(count: number): Card[] {
	return Array.from({ length: count }, (_, i) =>
		makeCard({
			id: `hotdog-${i}`,
			hero_name: `Hot Dog ${i}`,
			card_number: `HD-${i}`,
			power: 0,
			weapon_type: null as unknown as string,
		})
	);
}

describe('validateDeck', () => {
	it('passes a valid 60-card SPEC Playmaker deck', () => {
		const heroes = makeHeroDeck(60);
		const hotDogs = makeHotDogDeck(10);
		const result = validateDeck(heroes, 'spec_playmaker', [], hotDogs);
		expect(result.isValid).toBe(true);
		expect(result.violations).toHaveLength(0);
	});

	it('fails when deck has too few heroes', () => {
		const heroes = makeHeroDeck(50);
		const result = validateDeck(heroes, 'spec_playmaker');
		expect(result.isValid).toBe(false);
		expect(result.violations.some(v => v.rule === 'hero_deck_min')).toBe(true);
	});

	it('fails when a card exceeds SPEC power cap', () => {
		const heroes = makeHeroDeck(60);
		heroes[0] = makeCard({ power: 200, hero_name: 'OP Hero' });
		const result = validateDeck(heroes, 'spec_playmaker');
		expect(result.isValid).toBe(false);
		expect(result.violations.some(v => v.rule === 'spec_power_cap')).toBe(true);
	});

	it('fails when too many cards at same power level', () => {
		// 7 cards at power 100 (max is 6 per power level)
		const heroes = makeHeroDeck(60, { power: 100 });
		const result = validateDeck(heroes, 'spec_playmaker');
		expect(result.isValid).toBe(false);
		expect(result.violations.some(v => v.rule === 'max_per_power_level')).toBe(true);
	});

	it('fails when duplicate variations exist', () => {
		const heroes = makeHeroDeck(60);
		// Create exact duplicate variation: same hero + weapon + parallel
		heroes[1] = makeCard({ hero_name: 'Hero 0', weapon_type: 'Fire', parallel: null, card_number: 'BF-0-dup' });
		const result = validateDeck(heroes, 'spec_playmaker');
		expect(result.isValid).toBe(false);
		expect(result.violations.some(v => v.rule === 'max_per_variation')).toBe(true);
	});

	it('validates SPEC+ core deck requirement (60 cards must be ≤160)', () => {
		// 70 cards all at 170 power — only 0 are ≤160, need 60
		const heroes = makeHeroDeck(70, { power: 170 });
		const result = validateDeck(heroes, 'spec_plus');
		expect(result.isValid).toBe(false);
		expect(result.violations.some(v => v.rule === 'spec_plus_core')).toBe(true);
	});

	it('validates SPEC+ absolute max power of 200', () => {
		const heroes = makeHeroDeck(60);
		heroes[0] = makeCard({ power: 210, hero_name: 'Over Max' });
		const result = validateDeck(heroes, 'spec_plus');
		expect(result.isValid).toBe(false);
		expect(result.violations.some(v => v.rule === 'absolute_max_power')).toBe(true);
	});

	it('validates SPEC+ graduated power slot limits', () => {
		// 3 cards at power 165 — max is 2
		const heroes = makeHeroDeck(60);
		heroes[57] = makeCard({ power: 165, hero_name: 'Slot1', weapon_type: 'Fire' });
		heroes[58] = makeCard({ power: 165, hero_name: 'Slot2', weapon_type: 'Ice' });
		heroes[59] = makeCard({ power: 165, hero_name: 'Slot3', weapon_type: 'Steel' });
		const result = validateDeck(heroes, 'spec_plus');
		expect(result.isValid).toBe(false);
		expect(result.violations.some(v => v.rule === 'power_slot_limit')).toBe(true);
	});

	it('returns unknown format error for invalid format ID', () => {
		const result = validateDeck([], 'nonexistent_format');
		expect(result.isValid).toBe(false);
		expect(result.violations[0].rule).toBe('format');
	});

	it('fails when hot dog deck is empty but format requires 10', () => {
		const heroes = makeHeroDeck(60);
		const result = validateDeck(heroes, 'spec_playmaker', [], []);
		expect(result.isValid).toBe(false);
		expect(result.violations.some(v => v.rule === 'hot_dog_deck_size')).toBe(true);
	});

	it('computes correct deck stats', () => {
		const heroes = [
			makeCard({ power: 100, weapon_type: 'Fire' }),
			makeCard({ power: 120, weapon_type: 'Ice', hero_name: 'H2' }),
			makeCard({ power: 140, weapon_type: 'Fire', hero_name: 'H3' }),
		];
		const result = validateDeck(heroes, 'spec_playmaker');
		expect(result.stats.totalHeroes).toBe(3);
		expect(result.stats.totalPower).toBe(360);
		expect(result.stats.maxPower).toBe(140);
		expect(result.stats.minPower).toBe(100);
		expect(result.stats.weaponCounts['Fire']).toBe(2);
		expect(result.stats.weaponCounts['Ice']).toBe(1);
	});

	it('flags cards outside AlphaTrilogy card pool', () => {
		const heroes = makeHeroDeck(60, { set_code: 'AE' });
		heroes[0] = makeCard({ set_code: 'Tecmo Bowl', hero_name: 'Illegal Hero' });
		const result = validateDeck(heroes, 'alpha_trilogy_playmaker');
		expect(result.violations.some(v => v.rule === 'card_pool')).toBe(true);
	});

	it('allows Alpha Edition cards in AlphaTrilogy', () => {
		const heroes = makeHeroDeck(60, { set_code: 'AE' });
		const hotDogs = makeHotDogDeck(10);
		const result = validateDeck(heroes, 'alpha_trilogy_playmaker', [], hotDogs);
		expect(result.violations.some(v => v.rule === 'card_pool')).toBe(false);
	});

	it('skips card pool validation for all_in_rotation formats', () => {
		const heroes = makeHeroDeck(60, { set_code: 'Tecmo Bowl' });
		const hotDogs = makeHotDogDeck(10);
		const result = validateDeck(heroes, 'spec_playmaker', [], hotDogs);
		expect(result.violations.some(v => v.rule === 'card_pool')).toBe(false);
	});

	it('passes cards with empty set_code through card pool check', () => {
		const heroes = makeHeroDeck(60, { set_code: '' });
		const result = validateDeck(heroes, 'alpha_trilogy_playmaker');
		expect(result.violations.some(v => v.rule === 'card_pool')).toBe(false);
	});
});
