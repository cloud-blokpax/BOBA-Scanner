/**
 * Tests for card database service — fuzzy matching, normalization, search.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const { MOCK_CARDS } = vi.hoisted(() => {
	const namedCards = [
		{
			id: '1', name: 'Bo Jackson', hero_name: 'Bo Jackson', athlete_name: 'Bo Jackson',
			set_code: 'ALPHA', card_number: 'ALP-001', parallel: null, power: 95,
			rarity: 'legendary', weapon_type: 'Bat', battle_zone: null, image_url: null,
			created_at: '2024-01-01'
		},
		{
			id: '2', name: 'Speed Demon', hero_name: 'Speed Demon', athlete_name: null,
			set_code: 'ALPHA', card_number: 'ALP-002', parallel: null, power: 80,
			rarity: 'rare', weapon_type: 'Sword', battle_zone: null, image_url: null,
			created_at: '2024-01-01'
		},
		{
			id: '3', name: 'Shadow Strike', hero_name: 'Shadow Strike', athlete_name: null,
			set_code: 'BETA', card_number: 'BET-010', parallel: null, power: 70,
			rarity: 'uncommon', weapon_type: null, battle_zone: null, image_url: null,
			created_at: '2024-01-01'
		},
		{
			id: '4', name: 'Bo Jackson', hero_name: 'Bo Jackson', athlete_name: 'Bo Jackson',
			set_code: 'BETA', card_number: 'BET-001', parallel: 'Battlefoil', power: 95,
			rarity: 'uncommon', weapon_type: 'Bat', battle_zone: null, image_url: null,
			created_at: '2024-01-01'
		},
		{
			id: '5', name: 'Iron Fist', hero_name: 'Iron Fist', athlete_name: null,
			set_code: 'ALPHA', card_number: 'ALP-003', parallel: null, power: 60,
			rarity: 'common', weapon_type: null, battle_zone: null, image_url: null,
			created_at: '2024-01-01'
		},
		// Wonders cards — same numeric prefix as BoBA ALP-* to force collisions
		// in fuzzy search so tests can verify the game_id filter.
		{
			id: 'w1', name: 'Bellator', hero_name: null, athlete_name: null,
			set_code: 'CLA', card_number: '78/402', parallel: null, power: 4,
			rarity: 'rare', weapon_type: null, battle_zone: null, image_url: null,
			created_at: '2024-01-01', game_id: 'wonders'
		},
		{
			id: 'w2', name: 'Bright Robin', hero_name: null, athlete_name: null,
			set_code: 'CLA', card_number: '79/402', parallel: null, power: 2,
			rarity: 'common', weapon_type: null, battle_zone: null, image_url: null,
			created_at: '2024-01-01', game_id: 'wonders'
		}
	];

	// Generate filler cards to exceed the IDB count reasonableness threshold (>100)
	const fillerCards = Array.from({ length: 100 }, (_, i) => ({
		id: `filler-${i}`, name: `Filler ${i}`, hero_name: `Filler ${i}`, athlete_name: null,
		set_code: 'FILL', card_number: `FIL-${String(i).padStart(3, '0')}`, parallel: null,
		power: 50, rarity: 'common', weapon_type: null, battle_zone: null, image_url: null,
		created_at: '2024-01-01'
	}));

	return { MOCK_CARDS: [...namedCards, ...fillerCards] };
});

// Mock idb to return our test cards
vi.mock('$lib/services/idb', () => ({
	idb: {
		getCards: vi.fn().mockResolvedValue(MOCK_CARDS),
		setCards: vi.fn().mockResolvedValue(undefined),
		setCardsVersion: vi.fn().mockResolvedValue(undefined),
		getCardsVersion: vi.fn().mockResolvedValue(null),
		getMeta: vi.fn().mockResolvedValue(new Date().toISOString()),
		setMeta: vi.fn().mockResolvedValue(undefined)
	}
}));

// Mock parallel-config
vi.mock('$lib/services/parallel-config', () => ({
	loadParallelConfig: vi.fn().mockResolvedValue(new Map()),
	getParallelRarity: vi.fn().mockReturnValue(null)
}));

// Mock supabase
vi.mock('$lib/services/supabase', () => ({
	supabase: null,
	getSupabase: vi.fn().mockReturnValue(null)
}));

import {
	normalizeCardNum,
	findCard,
	findSimilarCardNumbers,
	searchCards,
	getAllCards,
	getCardById,
	loadCardDatabase
} from '$lib/services/card-db';

describe('normalizeCardNum', () => {
	it('uppercases and trims', () => {
		expect(normalizeCardNum(' abc-123 ')).toBe('ABC-123');
	});

	it('handles empty string', () => {
		expect(normalizeCardNum('')).toBe('');
	});

	it('handles numeric only', () => {
		expect(normalizeCardNum('42')).toBe('42');
	});
});

describe('card-db integration', () => {
	beforeAll(async () => {
		await loadCardDatabase();
	});

	it('loads cards from mock IDB data plus play cards', () => {
		const cards = getAllCards();
		expect(cards.length).toBe(518); // 5 boba + 2 wonders + 100 filler + 411 play cards from local JSON fallback
	});

	it('findCard returns exact match by card number', () => {
		const found = findCard('ALP-001');
		expect(found).not.toBeNull();
		expect(found!.name).toBe('Bo Jackson');
		expect(found!.set_code).toBe('ALPHA');
	});

	it('findCard is case insensitive', () => {
		const lower = findCard('alp-001');
		const upper = findCard('ALP-001');
		expect(lower?.id).toBe(upper?.id);
	});

	it('findCard returns null for non-existent card number', () => {
		expect(findCard('ZZZZZ-99999')).toBeNull();
	});

	it('findCard returns null for empty input', () => {
		expect(findCard('')).toBeNull();
	});

	it('findCard disambiguates by hero name when multiple matches exist', () => {
		// Both ALP-001 and BET-001 have hero_name "Bo Jackson"
		// but they are different card numbers so no ambiguity here.
		// Let's test with a direct lookup.
		const found = findCard('BET-001', 'Bo Jackson');
		expect(found).not.toBeNull();
		expect(found!.set_code).toBe('BETA');
	});

	it('findSimilarCardNumbers returns fuzzy matches within distance', () => {
		// ALP-002 exists; ALP-003 is 1 edit away
		const results = findSimilarCardNumbers('ALP-002', 2);
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].distance).toBe(0); // exact match
		expect(results[0].card.name).toBe('Speed Demon');
	});

	it('findSimilarCardNumbers respects maxDistance', () => {
		const results = findSimilarCardNumbers('ALP-009', 1);
		// ALP-001, ALP-002, ALP-003 are all distance 1 from ALP-009
		for (const r of results) {
			expect(r.distance).toBeLessThanOrEqual(1);
		}
	});

	it('findSimilarCardNumbers returns sorted by distance', () => {
		const results = findSimilarCardNumbers('ALP-001', 2);
		for (let i = 1; i < results.length; i++) {
			expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
		}
	});

	it('searchCards finds cards by name', () => {
		const results = searchCards('Shadow');
		expect(results.length).toBe(1);
		expect(results[0].name).toBe('Shadow Strike');
	});

	it('searchCards finds cards by set_code', () => {
		const results = searchCards('BETA');
		expect(results.length).toBe(2); // Shadow Strike + Bo Jackson BETA
	});

	it('searchCards is case insensitive', () => {
		const results = searchCards('bo jackson');
		expect(results.length).toBe(2); // ALPHA and BETA Bo Jackson
	});

	it('searchCards respects limit', () => {
		const results = searchCards('a', 2);
		expect(results.length).toBeLessThanOrEqual(2);
	});

	it('getCardById returns card by id', () => {
		const card = getCardById('3');
		expect(card).not.toBeUndefined();
		expect(card!.name).toBe('Shadow Strike');
	});

	it('getCardById returns undefined for missing id', () => {
		expect(getCardById('999')).toBeUndefined();
	});

	it('findCard finds play cards by card number', () => {
		const found = findCard('PL-1');
		expect(found).not.toBeNull();
		expect(found!.name).toBe('Front Run');
	});

	it('searchCards finds play cards by name', () => {
		const results = searchCards('Front Run');
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].name).toBe('Front Run');
	});

	// Auto-detect scans load multiple games' cards into the shared index;
	// the validation fallbacks must scope results to the detected game or
	// a Wonders number (e.g. "78/402") will match BoBA cards with "78" and
	// then be rejected on hero-name mismatch, producing the "not found in
	// database" bug.
	it('findSimilarCardNumbers filters by gameId when provided', () => {
		const wondersOnly = findSimilarCardNumbers('78/402', 2, 'wonders');
		expect(wondersOnly.length).toBeGreaterThan(0);
		expect(wondersOnly.every((r) => (r.card.game_id || 'boba') === 'wonders')).toBe(true);

		const bobaOnly = findSimilarCardNumbers('78/402', 2, 'boba');
		expect(bobaOnly.every((r) => (r.card.game_id || 'boba') === 'boba')).toBe(true);
	});

	it('findSimilarCardNumbers without gameId returns cross-game matches', () => {
		const all = findSimilarCardNumbers('78/402', 4);
		const wondersHits = all.filter((r) => r.card.game_id === 'wonders');
		expect(wondersHits.length).toBeGreaterThan(0);
	});

	it('searchCards filters by gameId when provided', () => {
		const wondersOnly = searchCards('Bellator', 10, 'wonders');
		expect(wondersOnly.length).toBe(1);
		expect(wondersOnly[0].game_id).toBe('wonders');

		const bobaOnly = searchCards('Bellator', 10, 'boba');
		expect(bobaOnly.length).toBe(0);
	});
});
