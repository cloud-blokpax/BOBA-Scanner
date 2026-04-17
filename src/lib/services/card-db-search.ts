/**
 * Card Database Search Module
 *
 * Search and fuzzy-matching functions extracted from card-db.ts.
 * Operates on indexes built and maintained by card-db.ts.
 */

import type { Card } from '$lib/types';
import { normalizeCardNum, getPrefixIndex, getHeroIndex, getSearchIndex } from './card-db';

// ── Levenshtein distance ────────────────────────────────────

export function levenshteinDistance(a: string, b: string): number {
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

// ── Hero matching helpers ───────────────────────────────────

export function extractQuotedNames(name: string): string[] {
	const matches: string[] = [];
	const regex = /[""\u201C]([^""\u201D]+)[""\u201D]|"([^"]+)"/g;
	let m;
	while ((m = regex.exec(name)) !== null) {
		const val = (m[1] || m[2] || '').trim();
		if (val.length >= 3) matches.push(val);
	}
	return matches;
}

export function heroMatches(card: Card, normalizedHero: string): boolean {
	const cardName = card.name?.toUpperCase() || '';
	const cardHero = card.hero_name?.toUpperCase() || '';

	if (cardName === normalizedHero || cardHero === normalizedHero) return true;

	const quotedNames = extractQuotedNames(cardName).concat(extractQuotedNames(cardHero));
	if (quotedNames.some((q) => q === normalizedHero)) return true;

	if (cardName && cardName.length >= 3 && normalizedHero.length >= 3 &&
		(cardName.includes(normalizedHero) || normalizedHero.includes(cardName))) {
		const ratio = Math.min(cardName.length, normalizedHero.length) / Math.max(cardName.length, normalizedHero.length);
		if (ratio >= 0.6) return true;
	}
	if (cardHero && cardHero.length >= 3 && normalizedHero.length >= 3 &&
		(cardHero.includes(normalizedHero) || normalizedHero.includes(cardHero))) {
		const ratio = Math.min(cardHero.length, normalizedHero.length) / Math.max(cardHero.length, normalizedHero.length);
		if (ratio >= 0.6) return true;
	}

	return false;
}

// ── Fuzzy search ────────────────────────────────────────────

/**
 * Fuzzy search using Levenshtein distance.
 *
 * When `gameId` is provided, results are restricted to cards matching that
 * game. Auto-detect scans load multiple games' cards into the shared index,
 * so cross-game contamination (e.g. a Wonders "78/402" pulling BoBA "78")
 * would otherwise reject the real match during hero-name verification.
 */
export function findSimilarCardNumbers(
	searchNumber: string,
	maxDistance = 2,
	gameId?: string
): Array<{ card: Card; cardNumber: string; distance: number; score: number }> {
	const normalized = normalizeCardNum(searchNumber);
	const prefix = normalized.slice(0, 2);
	const prefixIndex = getPrefixIndex();

	const candidateSet = new Set<Card>();
	for (const [key, cardList] of prefixIndex) {
		if (levenshteinDistance(key, prefix) <= 1) {
			for (const c of cardList) candidateSet.add(c);
		}
	}

	const results: Array<{ card: Card; cardNumber: string; distance: number; score: number }> = [];

	for (const card of candidateSet) {
		if (gameId && (card.game_id || 'boba') !== gameId) continue;
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

	results.sort((a, b) => {
		// Primary: lower distance wins
		if (a.distance !== b.distance) return a.distance - b.distance;
		// Secondary: prefer card numbers with similar length to the query
		const aLenDiff = Math.abs(a.cardNumber.length - normalized.length);
		const bLenDiff = Math.abs(b.cardNumber.length - normalized.length);
		return aLenDiff - bLenDiff;
	});
	return results;
}

// ── Full-text search ────────────────────────────────────────

/**
 * Full-text search across card name, hero name, set code.
 * Callers should debounce this if used on keystroke input.
 *
 * When `gameId` is provided, results are restricted to cards matching that
 * game (important during auto-detect scanning when multiple games' cards
 * share the search index).
 */
export function searchCards(query: string, limit = 20, gameId?: string): Card[] {
	const heroIndex = getHeroIndex();
	const searchIndex = getSearchIndex();

	const q = query.toUpperCase().trim();

	const heroMatch = heroIndex.get(q);
	if (heroMatch && heroMatch.length > 0) {
		const scoped = gameId
			? heroMatch.filter((c) => (c.game_id || 'boba') === gameId)
			: heroMatch;
		if (scoped.length > 0) return scoped.slice(0, limit);
	}

	// Use pre-computed lowercased search text for faster filtering
	const lq = query.toLowerCase();
	const results: Card[] = [];
	for (const entry of searchIndex) {
		if (gameId && (entry.card.game_id || 'boba') !== gameId) continue;
		if (entry.searchText.includes(lq)) {
			results.push(entry.card);
			if (results.length >= limit) break;
		}
	}
	return results;
}
