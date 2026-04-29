/**
 * WTP listing vocabulary — condition mapping + payload construction.
 *
 * WTP-specific values for condition, shipping, and other listing fields.
 * `buildWtpPayload` produces the canonical payload shape consumed by
 * the poster service and persisted in `wtp_postings.payload`.
 */

import { parallelToWtpTreatment } from './parallel-mapping';

export const CONDITION_TO_WTP: Record<string, string> = {
	'Mint': 'M',
	'Near Mint': 'NM',
	'Lightly Played': 'LP',
	'Moderately Played': 'MP',
	'Heavily Played': 'HP',
	'Damaged': 'DMG'
};

export interface BuildWtpPayloadInput {
	card_id: string;
	card_name: string;
	parallel: string;
	condition: string;
	rarity: string | null;
	orbital: string | null;
	set_name: string | null;
	special_attribute: string | null;
	card_number: string | null;
	quantity: number;
	price: number;
	description: string | null;
	accepting_offers: boolean;
	open_to_trade: boolean;
	shipping_mode: 'free' | 'flat' | 'per_item';
	shipping_fee: number;
}

export interface WtpListingPayload {
	listing_type: 'single';
	card_id: string;
	card_name: string;
	card_number: string | null;
	set_name: string | null;
	treatment: string;
	rarity: string | null;
	orbital: string | null;
	special_attribute: string | null;
	condition: string;
	quantity: number;
	price_cents: number;
	accepting_offers: boolean;
	open_to_trade: boolean;
	shipping: {
		mode: 'free' | 'flat' | 'per_item';
		fee_cents: number;
	};
	description: string | null;
}

export function buildWtpPayload(input: BuildWtpPayloadInput): WtpListingPayload {
	const treatment = parallelToWtpTreatment(input.parallel);
	if (!treatment) {
		throw new Error(`Parallel "${input.parallel}" does not map to a WTP treatment`);
	}

	const condition = CONDITION_TO_WTP[input.condition];
	if (!condition) {
		throw new Error(`Unknown condition "${input.condition}" — must be one of: ${Object.keys(CONDITION_TO_WTP).join(', ')}`);
	}

	if (!Number.isFinite(input.price) || input.price <= 0) {
		throw new Error('Price must be greater than 0');
	}

	if (!Number.isInteger(input.quantity) || input.quantity < 1) {
		throw new Error('Quantity must be a positive integer');
	}

	const shippingFee = input.shipping_mode === 'free' ? 0 : input.shipping_fee;
	if (input.shipping_mode !== 'free' && (!Number.isFinite(shippingFee) || shippingFee < 0)) {
		throw new Error('Shipping fee must be a non-negative number');
	}

	return {
		listing_type: 'single',
		card_id: input.card_id,
		card_name: input.card_name,
		card_number: input.card_number,
		set_name: input.set_name,
		treatment,
		rarity: input.rarity,
		orbital: input.orbital,
		special_attribute: input.special_attribute,
		condition,
		quantity: input.quantity,
		price_cents: Math.round(input.price * 100),
		accepting_offers: input.accepting_offers,
		open_to_trade: input.open_to_trade,
		shipping: {
			mode: input.shipping_mode,
			fee_cents: Math.round(shippingFee * 100)
		},
		description: input.description?.trim() || null
	};
}
