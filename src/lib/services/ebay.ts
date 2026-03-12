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

export interface EbaySoldData {
	lastSold: { price: number; date: string; title: string; url: string } | null;
	soldCount: number;
	avgSoldPrice: number | null;
	blocked: boolean;
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
export function buildEbayQuery(card: {
	card_number?: string | null;
	hero_name?: string | null;
	set_code?: string | null;
}): string {
	const parts: string[] = ['BOBA'];
	if (card.card_number) parts.push(card.card_number);
	if (card.hero_name) parts.push(card.hero_name);
	if (card.set_code) parts.push(card.set_code);
	return parts.join(' ');
}

/**
 * Build an eBay search URL with affiliate parameters.
 */
export function buildEbaySearchUrl(card: {
	card_number?: string | null;
	hero_name?: string | null;
	set_code?: string | null;
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
	set_code?: string | null;
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
 * Open eBay search in a new tab.
 */
export function openEbaySearch(card: {
	card_number?: string | null;
	hero_name?: string | null;
	set_code?: string | null;
}): void {
	if (!browser) return;
	window.open(buildEbaySearchUrl(card), '_blank');
}

/**
 * Fetch average price from eBay active listings.
 */
export async function fetchEbayAvgPrice(card: {
	card_number?: string | null;
	hero_name?: string | null;
	athlete_name?: string | null;
}): Promise<EbayPriceData> {
	const res = await fetch('/api/ebay/browse', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query: buildEbayQuery(card),
			cardNumber: card.card_number,
			hero: card.hero_name,
			athlete: card.athlete_name
		})
	});
	if (!res.ok) throw new Error(`eBay browse failed: ${res.status}`);
	return res.json();
}

/**
 * Fetch sold listing data from eBay.
 */
export async function fetchEbaySoldData(card: {
	card_number?: string | null;
	hero_name?: string | null;
	athlete_name?: string | null;
}): Promise<EbaySoldData> {
	const res = await fetch('/api/ebay/sold', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query: buildEbayQuery(card),
			cardNumber: card.card_number,
			hero: card.hero_name,
			athlete: card.athlete_name
		})
	});
	if (!res.ok) throw new Error(`eBay sold failed: ${res.status}`);
	return res.json();
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

/**
 * Generate an eBay listing using Claude.
 */
export async function generateEbayListing(card: {
	hero_name?: string | null;
	athlete_name?: string | null;
	card_number?: string | null;
	set_code?: string | null;
	weapon_type?: string | null;
	power?: number | null;
	rarity?: string | null;
}): Promise<{
	title: string;
	description: string;
	suggested_price: number;
	price_note: string;
	condition_code: string;
	keywords: string[];
}> {
	const prompt = buildListingPrompt(card);
	const res = await fetch('/api/scan', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ textPrompt: prompt, mode: 'listing' })
	});
	if (!res.ok) throw new Error(`Listing generation failed: ${res.status}`);
	const data = await res.json();

	const text =
		data.content?.[0]?.text || (typeof data === 'string' ? data : JSON.stringify(data));
	const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
	return JSON.parse(cleaned);
}

function buildListingPrompt(card: {
	hero_name?: string | null;
	athlete_name?: string | null;
	card_number?: string | null;
	set_code?: string | null;
	weapon_type?: string | null;
	power?: number | null;
	rarity?: string | null;
}): string {
	return `Generate an eBay listing for this BOBA trading card:
Hero: ${card.hero_name || 'Unknown'}
Athlete: ${card.athlete_name || 'Unknown'}
Card Number: ${card.card_number || 'Unknown'}
Set: ${card.set_code || 'Unknown'}
Weapon: ${card.weapon_type || 'Unknown'}
Power: ${card.power ?? 'Unknown'}
Rarity: ${card.rarity || 'Unknown'}

Return JSON with: title (max 80 chars), description (2-3 paragraphs), suggested_price, price_note, condition_code (3000=Good, 2000=Like New), keywords (array).`;
}
