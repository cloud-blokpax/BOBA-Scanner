/**
 * Card Database Service
 *
 * Loads the card database from Supabase, caches in IndexedDB,
 * and builds in-memory indexes for O(1) lookups and fuzzy search.
 */

import { supabase } from './supabase';
import { idb } from './idb';
import type { Card } from '$lib/types';

// ── In-memory indexes ──────────────────────────────────────
let cards: Card[] = [];
const cardIndex = new Map<string, Card[]>();
const prefixIndex = new Map<string, Card[]>();
let isLoaded = false;

/**
 * Load the card database. Checks IDB cache first, then Supabase.
 */
export async function loadCardDatabase(): Promise<Card[]> {
	if (isLoaded && cards.length > 0) return cards;

	try {
		// Check IDB cache
		const cached = await idb.getCards();
		if (cached && cached.length > 0) {
			cards = cached as Card[];
			buildIndexes();
			isLoaded = true;
			return cards;
		}
	} catch {
		// IDB unavailable, continue to fetch
	}

	// Fetch from Supabase
	const { data, error } = await supabase.from('cards').select('*');

	if (error) {
		console.error('Failed to load card database:', error.message);
		throw new Error('Card database unavailable');
	}

	cards = (data as unknown) as Card[];
	buildIndexes();
	isLoaded = true;

	// Cache in IDB for offline use
	try {
		await idb.setCards(cards);
		await idb.setCardsVersion(new Date().toISOString());
	} catch {
		// IDB write failure is non-critical
	}

	return cards;
}

/**
 * Build lookup indexes from the loaded card array.
 * - cardIndex: Map<normalizedCardNumber, Card[]> for O(1) exact lookup
 * - prefixIndex: Map<2-char prefix, Card[]> for fuzzy pre-filtering
 */
function buildIndexes() {
	cardIndex.clear();
	prefixIndex.clear();

	for (const card of cards) {
		const num = normalizeCardNum(card.card_number || '');
		if (!num) continue;

		if (!cardIndex.has(num)) cardIndex.set(num, []);
		cardIndex.get(num)!.push(card);

		const prefix = num.slice(0, 2);
		if (!prefixIndex.has(prefix)) prefixIndex.set(prefix, []);
		prefixIndex.get(prefix)!.push(card);
	}
}

/**
 * Normalize a card number for comparison.
 */
export function normalizeCardNum(val: string): string {
	return String(val).toUpperCase().trim();
}

/**
 * Find a card by card number with optional hero name disambiguation.
 */
export function findCard(
	cardNumber: string,
	heroName: string | null = null
): Card | null {
	if (!isLoaded || !cardNumber) return null;

	const normalized = normalizeCardNum(cardNumber);

	// Step 1: Exact match via index (O(1))
	const exactMatches = cardIndex.get(normalized) || [];

	if (exactMatches.length === 1) return exactMatches[0];

	if (exactMatches.length > 1 && heroName) {
		// Disambiguate by hero name
		const normalizedHero = heroName.toUpperCase();
		const heroMatch = exactMatches.find(
			(c) => c.name?.toUpperCase() === normalizedHero || c.hero_name?.toUpperCase() === normalizedHero
		);
		if (heroMatch) return heroMatch;
	}

	if (exactMatches.length > 0) return exactMatches[0];

	// Step 2: Fuzzy match via prefix pre-filtering
	const fuzzyResults = findSimilarCardNumbers(cardNumber, 2);
	if (fuzzyResults.length > 0) return fuzzyResults[0].card;

	return null;
}

/**
 * Fuzzy search using Levenshtein distance.
 * Pre-filters by 2-char prefix to avoid scanning all 17k+ cards.
 */
export function findSimilarCardNumbers(
	searchNumber: string,
	maxDistance = 2
): Array<{ card: Card; cardNumber: string; distance: number; score: number }> {
	const normalized = normalizeCardNum(searchNumber);
	const prefix = normalized.slice(0, 2);

	// Gather candidates: same prefix + adjacent prefixes (Levenshtein <= 1)
	const candidateSet = new Set<Card>();
	for (const [key, cardList] of prefixIndex) {
		if (levenshteinDistance(key, prefix) <= 1) {
			for (const c of cardList) candidateSet.add(c);
		}
	}

	const results: Array<{ card: Card; cardNumber: string; distance: number; score: number }> = [];

	for (const card of candidateSet) {
		const cardNum = normalizeCardNum(card.card_number || '');
		const distance = levenshteinDistance(normalized, cardNum);
		if (distance <= maxDistance) {
			results.push({
				card,
				cardNumber: cardNum,
				distance,
				score: 1 - distance / Math.max(normalized.length, cardNum.length)
			});
		}
	}

	results.sort((a, b) => a.distance - b.distance);
	return results;
}

/**
 * Full-text search across card name, hero name, set code.
 */
export function searchCards(query: string, limit = 20): Card[] {
	if (!isLoaded) return [];

	const q = query.toLowerCase();
	return cards
		.filter(
			(c) =>
				c.name?.toLowerCase().includes(q) ||
				c.hero_name?.toLowerCase().includes(q) ||
				c.set_code?.toLowerCase().includes(q) ||
				c.card_number?.toLowerCase().includes(q)
		)
		.slice(0, limit);
}

/**
 * Get all loaded cards.
 */
export function getAllCards(): Card[] {
	return cards;
}

/**
 * Get a card by its UUID.
 */
export function getCardById(id: string): Card | undefined {
	return cards.find((c) => c.id === id);
}

// ── Levenshtein distance ────────────────────────────────────

function levenshteinDistance(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	const dp = Array.from({ length: n + 1 }, (_, i) => i);

	for (let j = 1; j <= m; j++) {
		let prev = dp[0];
		dp[0] = j;
		for (let i = 1; i <= n; i++) {
			const temp = dp[i];
			dp[i] = a[j - 1] === b[i - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
			prev = temp;
		}
	}
	return dp[n];
}
