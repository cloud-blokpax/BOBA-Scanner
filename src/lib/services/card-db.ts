/**
 * Card Database Service
 *
 * Loading priority:
 *   1. IndexedDB cache (may contain fresher Supabase data from last session)
 *   2. Static bundled JSON (always available, ships with the build)
 *   3. Background Supabase refresh (picks up cards added after deployment)
 *
 * Tier 1 and Tier 2 scanning always work, even fully offline.
 */

import { STATIC_CARDS } from '$lib/data/static-cards';
import { idb } from './idb';
import { loadParallelConfig, getParallelRarity } from './parallel-config';
import type { Card } from '$lib/types';

// ── In-memory indexes ──────────────────────────────────────
let cards: Card[] = [];
const cardIndex = new Map<string, Card[]>();
const prefixIndex = new Map<string, Card[]>();
const idIndex = new Map<string, Card>();
let isLoaded = false;
let _loadPromise: Promise<Card[]> | null = null;

/**
 * Load the card database. Guarantees a usable card index is available.
 * Never throws — falls back to static data if all else fails.
 * Uses a shared promise to prevent concurrent duplicate loads.
 */
export async function loadCardDatabase(): Promise<Card[]> {
	if (isLoaded && cards.length > 0) return cards;

	// Prevent concurrent loads: if a load is already in progress, share its promise
	if (_loadPromise) return _loadPromise;
	_loadPromise = _loadCardDatabaseImpl();
	try {
		return await _loadPromise;
	} finally {
		_loadPromise = null;
	}
}

async function _loadCardDatabaseImpl(): Promise<Card[]> {
	if (isLoaded && cards.length > 0) return cards;

	// Layer 1: IndexedDB cache (may have fresher Supabase data)
	try {
		const cached = await idb.getCards();
		if (cached && cached.length > 0) {
			cards = cached as Card[];
			buildIndexes();
			isLoaded = true;
			refreshFromSupabaseInBackground();
			return cards;
		}
	} catch {
		// IDB unavailable — continue to static fallback
	}

	// Layer 2: Static bundled JSON (always available)
	cards = STATIC_CARDS;
	buildIndexes();
	isLoaded = true;

	// Apply admin-configured parallel→rarity mappings
	applyParallelConfig().catch(() => {});

	// Seed IDB from static data so future loads are faster
	try {
		await idb.setCards(cards);
		await idb.setCardsVersion('static-' + new Date().toISOString());
	} catch {
		// IDB write failure is non-critical
	}

	// Layer 3: Background Supabase refresh (non-blocking)
	refreshFromSupabaseInBackground();

	return cards;
}

/**
 * Non-blocking background refresh from Supabase.
 * If Supabase has more/newer cards, update the in-memory index and IDB cache.
 * If Supabase is unavailable, this silently does nothing.
 */
async function refreshFromSupabaseInBackground(): Promise<void> {
	try {
		// Dynamic import so Supabase is not a hard dependency
		const { getSupabase } = await import('./supabase');
		const supabase = getSupabase();
		if (!supabase) return;

		// Check cached version age — skip refresh if data was fetched recently (within 1 hour)
		const cachedVersion = await idb.getCardsVersion();
		if (cachedVersion?.startsWith('supabase-')) {
			const cachedTime = new Date(cachedVersion.replace('supabase-', '')).getTime();
			if (!isNaN(cachedTime) && Date.now() - cachedTime < 3600_000) return;
		}

		const { data, error } = await supabase.from('cards').select('*');
		if (error || !data || data.length === 0) return;

		// Compute a simple content hash to detect modifications (not just count changes)
		const contentHash = data.length + '-' + data.reduce((acc: number, c: Record<string, unknown>) => {
			const str = (c.card_number || '') + '|' + (c.rarity || '') + '|' + (c.hero_name || '');
			let hash = 0;
			for (let i = 0; i < (str as string).length; i++) hash = ((hash << 5) - hash + (str as string).charCodeAt(i)) | 0;
			return acc ^ hash;
		}, 0);

		const lastHash = await idb.getMeta<string>('cards-content-hash');
		if (lastHash === contentHash.toString()) {
			// Content unchanged — update timestamp to avoid re-fetching
			await idb.setCardsVersion('supabase-' + new Date().toISOString());
			return;
		}

		cards = data as unknown as Card[];
		buildIndexes();
		await applyParallelConfig();
		try {
			await idb.setCards(cards);
			await idb.setCardsVersion('supabase-' + new Date().toISOString());
			await idb.setMeta('cards-content-hash', contentHash.toString());
		} catch {
			// Non-critical
		}
	} catch {
		// Supabase unavailable — static data is sufficient
	}
}

/**
 * Apply admin-configured parallel→rarity mappings to all loaded cards.
 * Called after loading parallel config from Supabase.
 */
async function applyParallelConfig(): Promise<void> {
	const config = await loadParallelConfig();
	if (config.size === 0) return;

	for (const card of cards) {
		if (card.parallel) {
			card.rarity = getParallelRarity(card.parallel);
		}
	}
}

/**
 * Build lookup indexes from the loaded card array.
 */
function buildIndexes() {
	cardIndex.clear();
	prefixIndex.clear();
	idIndex.clear();

	for (const card of cards) {
		// ID index for O(1) lookup by id
		if (card.id) idIndex.set(card.id, card);

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
 * Find a card by card number with optional hero name verification.
 *
 * When heroName is provided, it is used both for disambiguation (multiple
 * cards sharing the same number) and for verification (ensuring the matched
 * card actually belongs to the expected hero).
 */
export function findCard(
	cardNumber: string,
	heroName: string | null = null
): Card | null {
	if (!isLoaded || !cardNumber) return null;

	const normalized = normalizeCardNum(cardNumber);
	const normalizedHero = heroName?.toUpperCase().trim() || null;

	// Step 1: Exact match via index (O(1))
	const exactMatches = cardIndex.get(normalized) || [];

	if (exactMatches.length === 1) {
		const card = exactMatches[0];
		// Verify hero name if provided — reject mismatches
		if (normalizedHero && !heroMatches(card, normalizedHero)) {
			console.warn(
				`[card-db] Card number "${normalized}" found but hero mismatch: ` +
				`expected="${normalizedHero}", actual name="${card.name}" hero="${card.hero_name}"`
			);
			// Don't return a wrong card — fall through to fuzzy match
			// which may find the right card with a slightly different number
		} else {
			return card;
		}
	}

	if (exactMatches.length > 1) {
		if (normalizedHero) {
			const heroMatch = exactMatches.find((c) => heroMatches(c, normalizedHero));
			if (heroMatch) return heroMatch;
		}
		// Multiple matches but no hero provided or no hero match — ambiguous
		// Still return first match as a best guess when no hero info
		if (!normalizedHero) return exactMatches[0];
		// Hero was provided but didn't match any — don't return wrong card
		console.warn(
			`[card-db] Card number "${normalized}" has ${exactMatches.length} matches but none match hero="${normalizedHero}"`
		);
	}

	// Step 2: Fuzzy match via prefix pre-filtering, hero-aware
	const fuzzyResults = findSimilarCardNumbers(cardNumber, 2);
	if (fuzzyResults.length > 0) {
		// If hero name is available, prefer fuzzy results that match the hero
		if (normalizedHero) {
			const heroFuzzy = fuzzyResults.find((r) => heroMatches(r.card, normalizedHero));
			if (heroFuzzy) return heroFuzzy.card;
		}
		// Without hero info, return best fuzzy match
		if (!normalizedHero) return fuzzyResults[0].card;
	}

	return null;
}

/**
 * Check if a card's name or hero_name matches the given hero string.
 * Uses case-insensitive comparison with support for partial/contains matching
 * to handle slight naming variations from AI identification.
 */
function heroMatches(card: Card, normalizedHero: string): boolean {
	const cardName = card.name?.toUpperCase() || '';
	const cardHero = card.hero_name?.toUpperCase() || '';

	// Exact match on either field
	if (cardName === normalizedHero || cardHero === normalizedHero) return true;

	// Quoted nickname match — card names like 'Barry "Cutback" Sanders' should
	// match when the AI returns just the nickname "Cutback" as the hero name.
	// Extract quoted portions from card name/hero and compare.
	const quotedNames = extractQuotedNames(cardName).concat(extractQuotedNames(cardHero));
	if (quotedNames.some((q) => q === normalizedHero)) return true;

	// Contains match (handles cases like "Air Jordan" vs "AIR JORDAN III")
	// Both strings must be at least 3 chars to avoid false positives like
	// "MICHAEL" matching "MICHAEL JORDAN" via substring.
	if (cardName && cardName.length >= 3 && normalizedHero.length >= 3 &&
		(cardName.includes(normalizedHero) || normalizedHero.includes(cardName))) {
		// Require the shorter string to be at least 60% the length of the longer
		// to avoid partial name false positives
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

/** Extract quoted substrings from a name (e.g., 'BARRY "CUTBACK" SANDERS' → ['CUTBACK']) */
function extractQuotedNames(name: string): string[] {
	const matches: string[] = [];
	const regex = /[""]([^""]+)[""]|"([^"]+)"/g;
	let m;
	while ((m = regex.exec(name)) !== null) {
		const val = (m[1] || m[2] || '').trim();
		if (val.length >= 3) matches.push(val);
	}
	return matches;
}

/**
 * Fuzzy search using Levenshtein distance.
 */
export function findSimilarCardNumbers(
	searchNumber: string,
	maxDistance = 2
): Array<{ card: Card; cardNumber: string; distance: number; score: number }> {
	const normalized = normalizeCardNum(searchNumber);
	const prefix = normalized.slice(0, 2);

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
 * Get a card by its ID (string).
 */
export function getCardById(id: string): Card | undefined {
	return idIndex.get(id);
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
