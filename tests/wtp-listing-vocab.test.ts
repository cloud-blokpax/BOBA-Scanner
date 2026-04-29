import { describe, it, expect } from 'vitest';
import { parallelToWtpTreatment } from '$lib/services/wtp/parallel-mapping';
import { buildWtpPayload, CONDITION_TO_WTP } from '$lib/services/wtp/listing-vocab';

describe('parallelToWtpTreatment', () => {
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

	it('accepts case-insensitive lookups', () => {
		expect(parallelToWtpTreatment('classic foil')).toBe('classic_foil');
		expect(parallelToWtpTreatment('STONEFOIL')).toBe('stonefoil');
	});

	it('returns null for unmapped parallels (e.g. BoBA names)', () => {
		expect(parallelToWtpTreatment('Battlefoil')).toBeNull();
		expect(parallelToWtpTreatment('Headlines Battlefoil')).toBeNull();
		expect(parallelToWtpTreatment(null)).toBeNull();
		expect(parallelToWtpTreatment(undefined)).toBeNull();
		expect(parallelToWtpTreatment('')).toBeNull();
	});
});

describe('buildWtpPayload', () => {
	const baseInput = {
		card_id: 'abc-123',
		card_name: 'Crystalline Dragon',
		parallel: 'Classic Foil',
		condition: 'Near Mint',
		rarity: 'Rare',
		orbital: 'Crystal',
		set_name: 'Classics',
		special_attribute: null,
		card_number: '78/402',
		quantity: 1,
		price: 12.5,
		description: '  ',
		accepting_offers: true,
		open_to_trade: false,
		shipping_mode: 'free' as const,
		shipping_fee: 0
	};

	it('produces a valid payload with mapped treatment + condition', () => {
		const p = buildWtpPayload(baseInput);
		expect(p.listing_type).toBe('single');
		expect(p.treatment).toBe('classic_foil');
		expect(p.condition).toBe(CONDITION_TO_WTP['Near Mint']);
		expect(p.price_cents).toBe(1250);
		expect(p.shipping.mode).toBe('free');
		expect(p.shipping.fee_cents).toBe(0);
		// Whitespace-only descriptions collapse to null
		expect(p.description).toBeNull();
	});

	it('rounds price to cents', () => {
		const p = buildWtpPayload({ ...baseInput, price: 9.999 });
		expect(p.price_cents).toBe(1000);
	});

	it('zeros shipping fee on free mode regardless of input', () => {
		const p = buildWtpPayload({ ...baseInput, shipping_mode: 'free', shipping_fee: 5 });
		expect(p.shipping.fee_cents).toBe(0);
	});

	it('preserves shipping fee on flat mode', () => {
		const p = buildWtpPayload({ ...baseInput, shipping_mode: 'flat', shipping_fee: 4.5 });
		expect(p.shipping.mode).toBe('flat');
		expect(p.shipping.fee_cents).toBe(450);
	});

	it('throws on unmapped parallel', () => {
		expect(() => buildWtpPayload({ ...baseInput, parallel: 'Battlefoil' })).toThrow(/WTP treatment/);
	});

	it('throws on unknown condition', () => {
		expect(() => buildWtpPayload({ ...baseInput, condition: 'Pristine' })).toThrow(/condition/i);
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
