import { describe, it, expect } from 'vitest';
import { validateCatalogTriangulation } from '../src/lib/services/catalog-validation';
import type { MirrorCard } from '../src/lib/services/catalog-mirror';

const mkCard = (over: Partial<MirrorCard> = {}): MirrorCard => ({
	id: '00000000-0000-0000-0000-000000000001',
	game_id: 'boba',
	card_number: 'BBF-82',
	hero_name: 'Dumper',
	name: 'Dumper',
	set_code: 'Griffey Edition',
	parallel: 'Blue Battlefoil',
	...over
} as MirrorCard);

describe('validateCatalogTriangulation', () => {
	it('passes when card_number and name agree on the candidate', () => {
		const r = validateCatalogTriangulation({
			game: 'boba',
			ocrCardNumber: 'BBF-82',
			ocrName: 'Dumper',
			ocrParallel: null,
			candidateCard: mkCard()
		});
		expect(r.passed).toBe(true);
	});

	it('fails when no candidate row was found', () => {
		const r = validateCatalogTriangulation({
			game: 'boba',
			ocrCardNumber: 'BBF-82',
			ocrName: 'Dumper',
			ocrParallel: null,
			candidateCard: null
		});
		expect(r).toEqual({ passed: false, reason: 'no_catalog_match' });
	});

	it('fails when card_number agrees but name is wildly different', () => {
		const r = validateCatalogTriangulation({
			game: 'boba',
			ocrCardNumber: 'BBF-82',
			ocrName: 'Crosbow',
			ocrParallel: null,
			candidateCard: mkCard()
		});
		expect(r).toEqual({ passed: false, reason: 'card_number_name_mismatch' });
	});

	it('passes when name has a single OCR character flip on a 6-char name', () => {
		// "Dumper" is 6 chars → threshold = 1; "Dumpr" is distance 1 from "Dumper".
		const r = validateCatalogTriangulation({
			game: 'boba',
			ocrCardNumber: 'BBF-82',
			ocrName: 'Dumpr',
			ocrParallel: null,
			candidateCard: mkCard()
		});
		expect(r.passed).toBe(true);
	});

	it('fails on Wonders parallel mismatch', () => {
		const wondersCard = mkCard({
			game_id: 'wonders',
			card_number: '316',
			hero_name: null,
			name: 'Punish',
			parallel: 'Classic Foil'
		});
		const r = validateCatalogTriangulation({
			game: 'wonders',
			ocrCardNumber: '316',
			ocrName: 'Punish',
			ocrParallel: 'Formless Foil',
			candidateCard: wondersCard
		});
		expect(r).toEqual({ passed: false, reason: 'parallel_mismatch' });
	});

	it('fails when only card_number is present', () => {
		const r = validateCatalogTriangulation({
			game: 'boba',
			ocrCardNumber: 'BBF-82',
			ocrName: null,
			ocrParallel: null,
			candidateCard: mkCard()
		});
		expect(r).toEqual({ passed: false, reason: 'card_number_only_no_name' });
	});

	it('fails when only name is present', () => {
		const r = validateCatalogTriangulation({
			game: 'boba',
			ocrCardNumber: null,
			ocrName: 'Dumper',
			ocrParallel: null,
			candidateCard: mkCard()
		});
		expect(r).toEqual({ passed: false, reason: 'name_only_no_card_number' });
	});

	it('handles fractional → integer card_number fallback', () => {
		const wondersCard = mkCard({
			game_id: 'wonders',
			card_number: '316',
			hero_name: null,
			name: 'Punish',
			parallel: 'Paper'
		});
		const r = validateCatalogTriangulation({
			game: 'wonders',
			ocrCardNumber: '316/401',
			ocrName: 'Punish',
			ocrParallel: null,
			candidateCard: wondersCard
		});
		expect(r.passed).toBe(true);
	});

	it('passes when Wonders parallel matches', () => {
		const wondersCard = mkCard({
			game_id: 'wonders',
			card_number: '316',
			hero_name: null,
			name: 'Punish',
			parallel: 'Classic Foil'
		});
		const r = validateCatalogTriangulation({
			game: 'wonders',
			ocrCardNumber: '316',
			ocrName: 'Punish',
			ocrParallel: 'Classic Foil',
			candidateCard: wondersCard
		});
		expect(r.passed).toBe(true);
	});

	it('passes when Wonders parallel is missing on the candidate (skipped)', () => {
		const wondersCard = mkCard({
			game_id: 'wonders',
			card_number: '316',
			hero_name: null,
			name: 'Punish',
			parallel: null
		});
		const r = validateCatalogTriangulation({
			game: 'wonders',
			ocrCardNumber: '316',
			ocrName: 'Punish',
			ocrParallel: 'Classic Foil',
			candidateCard: wondersCard
		});
		expect(r.passed).toBe(true);
	});
});
