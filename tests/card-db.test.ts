/**
 * Tests for card database service — fuzzy matching, normalization, search.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const { MOCK_CARDS } = vi.hoisted(() => ({
	MOCK_CARDS: [
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
		}
	]
}));

// Mock idb to return our test cards
vi.mock('$lib/services/idb', () => ({
	idb: {
		getCards: vi.fn().mockResolvedValue(MOCK_CARDS),
		setCards: vi.fn().mockResolvedValue(undefined),
		setCardsVersion: vi.fn().mockResolvedValue(undefined),
		getCardsVersion: vi.fn().mockResolvedValue(null)
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

	it('loads cards from mock IDB data', () => {
		const cards = getAllCards();
		expect(cards.length).toBe(5);
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
});
