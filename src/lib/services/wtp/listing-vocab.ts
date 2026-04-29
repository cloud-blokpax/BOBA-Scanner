/**
 * WTP listing payload — matches WTP's actual `listings` table schema
 * exactly (verified against /rest/v1/listings on their public API).
 */

// WTP enum: full strings, exactly as stored in their DB
export const CONDITION_TO_WTP: Record<string, string> = {
	Mint: 'Mint',
	'Near Mint': 'Near Mint',
	'Lightly Played': 'Lightly Played',
	'Moderately Played': 'Played', // collapse — WTP has no Moderately Played
	Played: 'Played',
	'Heavily Played': 'Heavily Played',
	Damaged: 'Heavily Played' // collapse — WTP has no Damaged
};

export const ATTRIBUTE_TO_WTP: Record<string, string> = {
	None: 'None',
	Echo: 'Echo',
	'Alt-Art': 'Alt-Art',
	Promo: 'Promo',
	'Pre-Release Slab': 'Pre-Release Slabs',
	Autograph: 'Autographs',
	Autographs: 'Autographs',
	'Pre-Release Slabs': 'Pre-Release Slabs'
};

// Our parallel (cards.parallel) → WTP's treatment enum value.
// Distinct from the existing parallel-mapping.ts which used snake_case
// hypothetical values; WTP's actual `listings.treatment` column uses these:
const PARALLEL_TO_WTP_TREATMENT_INBOUND: Record<string, string> = {
	Paper: 'Paper',
	'Classic Foil': 'Classic Foil',
	'Formless Foil': 'Formless Foil',
	'Orbital Color Match': 'OCM',
	Stonefoil: 'Stone Foil'
};

export function parallelToWtpTreatmentReal(parallel: string | null | undefined): string | null {
	if (!parallel) return null;
	return PARALLEL_TO_WTP_TREATMENT_INBOUND[parallel] ?? null;
}

export interface BuildWtpPayloadInput {
	// All fields editable in the composer — defaults come from scan resolution
	card_name: string;
	set_name: string; // 'Existence' | 'Call of the Stones'
	treatment: string; // already in WTP vocab — e.g. 'Paper', 'Classic Foil', 'OCM'
	orbital: string; // 'Boundless' | 'Heliosynth' | 'Petraia' | 'Solfera' | 'Thalwind' | 'Umbrathene' | 'All Orbital Link'
	rarity: string; // 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Mythic' | 'Token' | 'Promo'
	special_attribute: string; // WTP enum
	card_number: string | null;
	condition: string; // user choice — gets mapped through CONDITION_TO_WTP
	quantity: number;
	price: number; // dollars
	description: string | null;
	accepting_offers: boolean;
	open_to_trade: boolean;
	shipping_mode: 'free' | 'flat' | 'per_item';
	shipping_fee: number;
}

export interface WtpListingPayload {
	listing_type: 'card';
	card_name: string;
	set: string;
	treatment: string;
	orbital: string;
	rarity: string;
	special_attribute: string;
	condition: string;
	quantity: number;
	price: number;
	description: string | null;
	accepting_offers: boolean;
	open_to_trade: boolean;
	shipping_free: boolean;
	shipping_fee: number;
	shipping_per_item: boolean;
}

export function buildWtpPayload(input: BuildWtpPayloadInput): WtpListingPayload {
	const condition = CONDITION_TO_WTP[input.condition] ?? input.condition;

	if (!Number.isFinite(input.price) || input.price <= 0) {
		throw new Error('Price must be greater than 0');
	}
	if (!Number.isInteger(input.quantity) || input.quantity < 1) {
		throw new Error('Quantity must be a positive integer');
	}

	// Card number → first line of description (WTP has no structured card_number field)
	const cardNumLine = input.card_number ? `#${input.card_number}` : null;
	const userDesc = input.description?.trim() || null;
	const description = [cardNumLine, userDesc].filter(Boolean).join('\n\n') || null;

	return {
		listing_type: 'card',
		card_name: input.card_name.trim(),
		set: input.set_name,
		treatment: input.treatment,
		orbital: input.orbital,
		rarity: input.rarity,
		special_attribute: ATTRIBUTE_TO_WTP[input.special_attribute] ?? input.special_attribute,
		condition,
		quantity: input.quantity,
		price: Math.round(input.price * 100) / 100, // dollars, 2 decimals
		description,
		accepting_offers: input.accepting_offers,
		open_to_trade: input.open_to_trade,
		shipping_free: input.shipping_mode === 'free',
		shipping_fee: input.shipping_mode === 'free' ? 0 : Math.round(input.shipping_fee * 100) / 100,
		shipping_per_item: input.shipping_mode === 'per_item'
	};
}
