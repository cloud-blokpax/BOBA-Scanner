/**
 * Card Database Service
 *
 * Loading priority:
 *   1. IndexedDB cache (contains Supabase data from last session)
 *   2. Supabase fetch (downloads all cards, caches to IDB)
 *
 * After initial load, background delta syncs keep data fresh.
 * Fully offline-capable after first successful load.
 */

import { idb } from './idb';
import { loadParallelConfig, getParallelRarity } from './parallel-config';
import type { Card } from '$lib/types';

// ── In-memory indexes ──────────────────────────────────────
let cards: Card[] = [];
const cardIndex = new Map<string, Card[]>();
const prefixIndex = new Map<string, Card[]>();
const idIndex = new Map<string, Card>();
const heroIndex = new Map<string, Card[]>();
let isLoaded = false;
let _loadPromise: Promise<Card[]> | null = null;

// ── Loading progress callback (for UI feedback) ──────────────
type LoadingCallback = (phase: 'idle' | 'idb' | 'network' | 'indexing' | 'ready', count: number) => void;
let _onLoadingProgress: LoadingCallback | null = null;

export function setLoadingCallback(cb: LoadingCallback | null) {
	_onLoadingProgress = cb;
}

/**
 * Load the card database. Guarantees a usable card index is available.
 * Never throws — returns an empty array if all sources fail.
 * Uses a shared promise to prevent concurrent duplicate loads.
 */
export async function loadCardDatabase(): Promise<Card[]> {
	if (isLoaded && cards.length > 0) return cards;

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

	// Layer 1: IndexedDB cache
	_onLoadingProgress?.('idb', 0);
	try {
		const cached = await idb.getCards();
		if (cached && cached.length > 0) {
			const firstItem = cached[0] as Record<string, unknown>;
			if (firstItem && typeof firstItem.id === 'string' && 'card_number' in firstItem) {
				cards = cached as Card[];
				buildIndexes();
				isLoaded = true;
				_onLoadingProgress?.('ready', cards.length);
				// Background refresh from Supabase (non-blocking)
				refreshFromSupabaseInBackground();
				return cards;
			}
			console.debug('[card-db] IDB cache has unexpected shape, will fetch from Supabase');
		}
	} catch (err) {
		console.debug('[card-db] IDB cache read failed:', err);
	}

	// Layer 2: Full fetch from Supabase (first-time load or corrupt IDB)
	_onLoadingProgress?.('network', 0);
	try {
		const { getSupabase } = await import('./supabase');
		const client = getSupabase();
		if (client) {
			const BATCH_SIZE = 1000;
			let allCards: Card[] = [];
			let offset = 0;
			let hasMore = true;

			while (hasMore) {
				const { data, error } = await client
					.from('cards')
					.select('*')
					.range(offset, offset + BATCH_SIZE - 1)
					.order('id');

				if (error) throw error;
				if (!data || data.length === 0) {
					hasMore = false;
				} else {
					allCards = allCards.concat(data as Card[]);
					offset += BATCH_SIZE;
					_onLoadingProgress?.('network', allCards.length);
					if (data.length < BATCH_SIZE) hasMore = false;
				}
			}

			if (allCards.length > 0) {
				cards = allCards;
				_onLoadingProgress?.('indexing', cards.length);
				buildIndexes();
				isLoaded = true;
				_onLoadingProgress?.('ready', cards.length);

				// Cache in IDB for offline use
				try {
					await idb.setCards(cards);
					await idb.setMeta('lastCardSync', new Date().toISOString());
					await idb.setCardsVersion('supabase-' + new Date().toISOString());
					console.debug(`[card-db] Cached ${cards.length} cards in IDB`);
				} catch (err) {
					console.debug('[card-db] IDB cache write failed:', err);
				}

				return cards;
			}
		}
	} catch (err) {
		console.debug('[card-db] Supabase fetch failed:', err);
	}

	// All sources failed — return empty (app runs in degraded mode)
	console.warn('[card-db] No card data available from any source');
	_onLoadingProgress?.('ready', 0);
	isLoaded = true;
	return [];
}

/**
 * Non-blocking background refresh from Supabase.
 * If Supabase has more/newer cards, update the in-memory index and IDB cache.
 * Uses exponential backoff on failure: 1hr → 2hr → 4hr → 8hr cap.
 */
let _refreshFailCount = 0;

async function refreshFromSupabaseInBackground(): Promise<void> {
	try {
		const { getSupabase } = await import('./supabase');
		const supabase = getSupabase();
		if (!supabase) return;

		// Check cached version age — skip refresh with exponential backoff on failure
		const backoffMs = Math.min(3600_000 * Math.pow(2, _refreshFailCount), 28800_000);
		const cachedVersion = await idb.getCardsVersion();
		if (cachedVersion?.startsWith('supabase-')) {
			const cachedTime = new Date(cachedVersion.replace('supabase-', '')).getTime();
			if (!isNaN(cachedTime) && Date.now() - cachedTime < backoffMs) return;
		}

		// Try incremental refresh first (only cards updated since last sync)
		const lastSyncTime = await idb.getMeta<string>('cards-last-sync');
		let isIncremental = false;

		if (lastSyncTime && cards.length > 0) {
			const { data: newCards, error } = await supabase
				.from('cards')
				.select('*')
				.gt('updated_at', lastSyncTime);
			if (!error && newCards && newCards.length > 0) {
				const cardMap = new Map(cards.map(c => [c.id, c]));
				for (const card of newCards) {
					cardMap.set((card as { id: string }).id, card as unknown as Card);
				}
				cards = [...cardMap.values()];
				isIncremental = true;
			} else if (!error && newCards && newCards.length === 0) {
				await idb.setCardsVersion('supabase-' + new Date().toISOString());
				await idb.setMeta('cards-last-sync', new Date().toISOString());
				_refreshFailCount = 0;
				return;
			}
		}

		if (!isIncremental) {
			const { data, error } = await supabase.from('cards').select('*');
			if (error || !data || data.length === 0) return;
			cards = data as unknown as Card[];
		}

		buildIndexes();
		await applyParallelConfig();
		try {
			await idb.setCards(cards);
			await idb.setCardsVersion('supabase-' + new Date().toISOString());
			await idb.setMeta('cards-last-sync', new Date().toISOString());
		} catch (err) {
			console.debug('[card-db] IDB refresh write failed:', err);
		}
		_refreshFailCount = 0;
	} catch (err) {
		_refreshFailCount = Math.min(_refreshFailCount + 1, 4);
		console.debug('[card-db] Supabase refresh failed (backoff count:', _refreshFailCount, '):', err);
	}
}

/**
 * Apply admin-configured parallel→rarity mappings to all loaded cards.
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
	heroIndex.clear();

	for (const card of cards) {
		if (card.id) idIndex.set(card.id, card);

		const heroKey = (card.hero_name || card.name || '').toUpperCase().trim();
		if (heroKey) {
			if (!heroIndex.has(heroKey)) heroIndex.set(heroKey, []);
			heroIndex.get(heroKey)!.push(card);
		}

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
 */
export function findCard(
	cardNumber: string,
	heroName: string | null = null
): Card | null {
	if (!isLoaded || !cardNumber) return null;

	const normalized = normalizeCardNum(cardNumber);
	const normalizedHero = heroName?.toUpperCase().trim() || null;

	const exactMatches = cardIndex.get(normalized) || [];

	if (exactMatches.length === 1) {
		const card = exactMatches[0];
		if (normalizedHero && !heroMatches(card, normalizedHero)) {
			console.warn(
				`[card-db] Card number "${normalized}" found but hero mismatch: ` +
				`expected="${normalizedHero}", actual name="${card.name}" hero="${card.hero_name}"`
			);
		} else {
			return card;
		}
	}

	if (exactMatches.length > 1) {
		if (normalizedHero) {
			const heroMatch = exactMatches.find((c) => heroMatches(c, normalizedHero));
			if (heroMatch) return heroMatch;
		}
		if (!normalizedHero) return exactMatches[0];
		console.warn(
			`[card-db] Card number "${normalized}" has ${exactMatches.length} matches but none match hero="${normalizedHero}"`
		);
	}

	const fuzzyResults = findSimilarCardNumbers(cardNumber, 2);
	if (fuzzyResults.length > 0) {
		if (normalizedHero) {
			const heroFuzzy = fuzzyResults.find((r) => heroMatches(r.card, normalizedHero));
			if (heroFuzzy) return heroFuzzy.card;
		}
		if (!normalizedHero) return fuzzyResults[0].card;
	}

	return null;
}

function heroMatches(card: Card, normalizedHero: string): boolean {
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

function extractQuotedNames(name: string): string[] {
	const matches: string[] = [];
	const regex = /[""\u201C]([^""\u201D]+)[""\u201D]|"([^"]+)"/g;
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

	const q = query.toUpperCase().trim();

	const heroMatch = heroIndex.get(q);
	if (heroMatch && heroMatch.length > 0) {
		return heroMatch.slice(0, limit);
	}

	const lq = query.toLowerCase();
	return cards
		.filter(
			(c) =>
				c.name?.toLowerCase().includes(lq) ||
				c.hero_name?.toLowerCase().includes(lq) ||
				c.set_code?.toLowerCase().includes(lq) ||
				c.card_number?.toLowerCase().includes(lq)
		)
		.slice(0, limit);
}

export function getAllCards(): Card[] {
	return cards;
}

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
