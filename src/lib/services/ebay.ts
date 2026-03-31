/**
 * eBay marketplace utilities.
 *
 * Replaces legacy src/features/marketplace/ebay.js.
 * Provides search URL building, price fetching, and affiliate link generation.
 */

import { browser } from '$app/environment';

/** EPN affiliate parameters. */
const EPN_PARAMS: Record<string, string> = {
	mkevt: '1',
	mkcid: '1',
	mkrid: '711-53200-19255-0',
	campid: '5339108029',
	toolid: '10001',
	siteid: '0'
};

export interface EbayPriceData {
	avgPrice: number | null;
	lowPrice: number | null;
	highPrice: number | null;
	count: number;
}

export interface EbayListing {
	title: string;
	price: number;
	url: string;
	itemId: string;
}

/**
 * Build an eBay search query from card metadata.
 */
function buildEbayQuery(card: {
	card_number?: string | null;
	hero_name?: string | null;
	athlete_name?: string | null;
}): string {
	const parts: string[] = ['BOBA'];
	if (card.card_number) parts.push(card.card_number);
	if (card.hero_name) parts.push(card.hero_name);
	if (card.athlete_name) parts.push(card.athlete_name);
	return parts.join(' ');
}

/**
 * Build an eBay search URL with affiliate parameters.
 */
export function buildEbaySearchUrl(card: {
	card_number?: string | null;
	hero_name?: string | null;
	athlete_name?: string | null;
}): string {
	const query = buildEbayQuery(card);
	const params = new URLSearchParams({
		_nkw: query,
		...EPN_PARAMS
	});
	return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

/**
 * Build a sold/completed items eBay search URL.
 */
export function buildEbaySoldUrl(card: {
	card_number?: string | null;
	hero_name?: string | null;
	athlete_name?: string | null;
}): string {
	const query = buildEbayQuery(card);
	const params = new URLSearchParams({
		_nkw: query,
		LH_Sold: '1',
		LH_Complete: '1',
		...EPN_PARAMS
	});
	return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

/**
 * Fetch seller listings via eBay Browse API.
 */
export async function fetchSellerListings(sellerUsername: string): Promise<EbayListing[]> {
	const res = await fetch('/api/ebay/browse', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ seller: sellerUsername })
	});
	if (!res.ok) throw new Error(`Seller fetch failed: ${res.status}`);
	const data = await res.json();
	return data.listings || [];
}

/**
 * Score how well a listing title matches a card.
 */
export function scoreListingMatch(
	title: string,
	card: {
		card_number?: string | null;
		hero_name?: string | null;
		weapon_type?: string | null;
	}
): number {
	const t = title.toUpperCase();
	let score = 0;

	if (card.card_number && t.includes(card.card_number.toUpperCase())) score += 50;

	if (card.hero_name) {
		const words = card.hero_name.toUpperCase().split(/\s+/);
		if (words.every((w) => t.includes(w))) score += 30;
	}

	if (card.weapon_type && t.includes(card.weapon_type.toUpperCase())) score += 10;

	return score;
}

