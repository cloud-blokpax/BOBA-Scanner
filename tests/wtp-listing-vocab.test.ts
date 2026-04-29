import { describe, it, expect } from 'vitest';
import { parallelToWtpTreatment } from '$lib/services/wtp/parallel-mapping';
import {
	buildWtpPayload,
	parallelToWtpTreatmentReal,
	CONDITION_TO_WTP
} from '$lib/services/wtp/listing-vocab';

describe('parallelToWtpTreatment (legacy mapping — used by harvester / scraping_test)', () => {
	it('maps Wonders full names to WTP treatment codes', () => {
		expect(parallelToWtpTreatment('Paper')).toBe('paper');
		expect(parallelToWtpTreatment('Classic Foil')).toBe('classic_foil');
		expect(parallelToWtpTreatment('Formless Foil')).toBe('formless_foil');
		expect(parallelToWtpTreatment('Orbital Color Match')).toBe('orbital_color_match');
		expect(parallelToWtpTreatment('Stonefoil')).toBe('stonefoil');
	});

	it('accepts short codes emitted by the parallel classifier', () => {
		expect(parallelToWtpTreatment('cf')).toBe('classic_foil');
		expect(parallelToWtpTreatment('ff')).toBe('formless_foil');
		expect(parallelToWtpTreatment('ocm')).toBe('orbital_color_match');
		expect(parallelToWtpTreatment('sf')).toBe('stonefoil');
	});

	it('returns null for unmapped parallels (e.g. BoBA names)', () => {
		expect(parallelToWtpTreatment('Battlefoil')).toBeNull();
		expect(parallelToWtpTreatment(null)).toBeNull();
	});
});

describe('parallelToWtpTreatmentReal (sell flow — Option B mapping)', () => {
	it('maps cards.parallel values to WTP listings.treatment enum strings', () => {
		expect(parallelToWtpTreatmentReal('Paper')).toBe('Paper');
		expect(parallelToWtpTreatmentReal('Classic Foil')).toBe('Classic Foil');
		expect(parallelToWtpTreatmentReal('Formless Foil')).toBe('Formless Foil');
		expect(parallelToWtpTreatmentReal('Orbital Color Match')).toBe('OCM');
		expect(parallelToWtpTreatmentReal('Stonefoil')).toBe('Stone Foil');
	});

	it('returns null for unmapped or empty input', () => {
		expect(parallelToWtpTreatmentReal('Battlefoil')).toBeNull();
		expect(parallelToWtpTreatmentReal(null)).toBeNull();
		expect(parallelToWtpTreatmentReal(undefined)).toBeNull();
		expect(parallelToWtpTreatmentReal('')).toBeNull();
	});
});

describe('buildWtpPayload', () => {
	const baseInput = {
		card_name: 'Crystalline Dragon',
		set_name: 'Existence',
		treatment: 'Classic Foil',
		orbital: 'Boundless',
		rarity: 'Rare',
		special_attribute: 'None',
		card_number: '78/402',
		condition: 'Near Mint',
		quantity: 1,
		price: 12.5,
		description: null,
		accepting_offers: true,
		open_to_trade: false,
		shipping_mode: 'free' as const,
		shipping_fee: 0
	};

	it('produces a valid payload with mapped condition + WTP-shaped fields', () => {
		const p = buildWtpPayload(baseInput);
		expect(p.listing_type).toBe('card');
		expect(p.treatment).toBe('Classic Foil');
		expect(p.condition).toBe(CONDITION_TO_WTP['Near Mint']);
		expect(p.price).toBe(12.5);
		expect(p.shipping_free).toBe(true);
		expect(p.shipping_per_item).toBe(false);
		expect(p.shipping_fee).toBe(0);
	});

	it('prepends card number to description', () => {
		const p = buildWtpPayload({ ...baseInput, description: 'great shape' });
		expect(p.description).toContain('#78/402');
		expect(p.description).toContain('great shape');
	});

	it('description is just card number line when user notes are blank', () => {
		const p = buildWtpPayload({ ...baseInput, description: '   ' });
		expect(p.description).toBe('#78/402');
	});

	it('description is null when no card number and no user notes', () => {
		const p = buildWtpPayload({ ...baseInput, card_number: null, description: null });
		expect(p.description).toBeNull();
	});

	it('rounds price to cents', () => {
		const p = buildWtpPayload({ ...baseInput, price: 9.999 });
		expect(p.price).toBe(10);
	});

	it('zeros shipping fee on free mode regardless of input', () => {
		const p = buildWtpPayload({ ...baseInput, shipping_mode: 'free', shipping_fee: 5 });
		expect(p.shipping_free).toBe(true);
		expect(p.shipping_fee).toBe(0);
	});

	it('preserves shipping fee on flat mode', () => {
		const p = buildWtpPayload({ ...baseInput, shipping_mode: 'flat', shipping_fee: 4.5 });
		expect(p.shipping_free).toBe(false);
		expect(p.shipping_per_item).toBe(false);
		expect(p.shipping_fee).toBe(4.5);
	});

	it('flags shipping_per_item on per_item mode', () => {
		const p = buildWtpPayload({ ...baseInput, shipping_mode: 'per_item', shipping_fee: 1 });
		expect(p.shipping_free).toBe(false);
		expect(p.shipping_per_item).toBe(true);
		expect(p.shipping_fee).toBe(1);
	});

	it('collapses Moderately Played → Played and Damaged → Heavily Played', () => {
		expect(buildWtpPayload({ ...baseInput, condition: 'Moderately Played' }).condition).toBe(
			'Played'
		);
		expect(buildWtpPayload({ ...baseInput, condition: 'Damaged' }).condition).toBe(
			'Heavily Played'
		);
	});

	it('throws on non-positive price', () => {
		expect(() => buildWtpPayload({ ...baseInput, price: 0 })).toThrow(/Price/);
		expect(() => buildWtpPayload({ ...baseInput, price: -1 })).toThrow(/Price/);
	});

	it('throws on bad quantity', () => {
		expect(() => buildWtpPayload({ ...baseInput, quantity: 0 })).toThrow(/Quantity/);
		expect(() => buildWtpPayload({ ...baseInput, quantity: 1.5 })).toThrow(/Quantity/);
	});
});
