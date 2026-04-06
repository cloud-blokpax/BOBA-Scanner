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
import { invalidateFeaturedCache } from './pack-simulator';
import type { Card } from '$lib/types';
import localPlayCards from '$lib/data/play-cards.json';
import { heroMatches, findSimilarCardNumbers } from './card-db-search';

// Re-export search functions for backward compatibility
export { findSimilarCardNumbers, searchCards, heroMatches, levenshteinDistance } from './card-db-search';

interface PlayCardRaw {
	id: string;
	card_number: string;
	name: string;
	release: string;
	type?: string;
	number?: number;
	hot_dog_cost?: number;
	dbs?: number;
	ability?: string;
	base_play_name?: string;
}

/**
 * Map a play card record to the Card interface so it can be indexed
 * alongside hero cards. Hero-specific fields are set to null.
 */
function playCardToCard(p: PlayCardRaw): Card {
	return {
		id: p.id,
		name: p.name,
		hero_name: null,
		athlete_name: null,
		set_code: p.release || '',
		card_number: p.card_number,
		parallel: null,
		power: null,
		rarity: null,
		weapon_type: null,
		battle_zone: null,
		image_url: null,
		created_at: '',
		base_play_name: p.base_play_name,
	};
}

/**
 * Fetch play cards from Supabase play_cards table.
 * Falls back to the bundled local JSON if Supabase is unavailable.
 */
async function loadPlayCards(): Promise<Card[]> {
	// Build a lookup from bundled local JSON for name fallback
	const localByCardNumber = new Map<string, PlayCardRaw>();
	const localCount = (localPlayCards as PlayCardRaw[]).length;
	for (const p of localPlayCards as PlayCardRaw[]) {
		localByCardNumber.set(p.card_number, p);
	}

	// Try Supabase first
	try {
		const { getSupabase } = await import('./supabase');
		const client = getSupabase();
		if (client) {
			const { data, error } = await client
				.from('play_cards')
				.select('id, card_number, name, release, hot_dog_cost, dbs')
				.order('card_number') as { data: Array<Record<string, unknown>> | null; error: unknown };

			if (error) {
				console.warn('[card-db] Supabase play_cards query error:', error);
			} else if (data && data.length > 0) {
				console.debug(`[card-db] Loaded ${data.length} play cards from Supabase`);
				return data.map(row => {
					const cardNumber = String(row.card_number ?? '');
					const localFallback = localByCardNumber.get(cardNumber);
					const name = (row.name ? String(row.name) : '') || localFallback?.name || '';
					return playCardToCard({
						id: String(row.id),
						card_number: cardNumber,
						name,
						release: String(row.release ?? '') || localFallback?.release || '',
						dbs: (row.dbs as number) ?? localFallback?.dbs ?? 0,
						hot_dog_cost: (row.hot_dog_cost as number) ?? localFallback?.hot_dog_cost ?? 0,
						ability: localFallback?.ability,
						base_play_name: localFallback?.base_play_name,
					});
				});
			} else {
				console.warn(`[card-db] Supabase play_cards returned 0 rows (table may be empty)`);
			}
		}
	} catch (err) {
		console.warn('[card-db] Supabase play_cards fetch failed:', err);
	}

	// Fallback: bundled local JSON
	console.debug(`[card-db] Using bundled play-cards.json (${localCount} cards)`);
	try {
		const result = (localPlayCards as PlayCardRaw[]).map(playCardToCard);
		if (result.length === 0) {
			console.error('[card-db] CRITICAL: Bundled play-cards.json produced 0 cards');
		}
		return result;
	} catch (err) {
		console.error('[card-db] CRITICAL: Bundled play-cards.json mapping failed:', err);
		return [];
	}
}

// ── In-memory indexes ──────────────────────────────────────
let cards: Card[] = [];
const cardIndex = new Map<string, Card[]>();
const prefixIndex = new Map<string, Card[]>();
const idIndex = new Map<string, Card>();
const heroIndex = new Map<string, Card[]>();
let searchIndex: Array<{ card: Card; searchText: string }> = [];
let isLoaded = false;
let _loadPromise: Promise<Card[]> | null = null;


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

/**
 * Force a full reload from Supabase, bypassing IDB and in-memory caches.
 * Used when stale card IDs are detected (e.g. FK violations on collection insert).
 */
export async function forceReloadCardDatabase(): Promise<Card[]> {
	isLoaded = false;
	cards = [];
	cardIndex.clear();
	prefixIndex.clear();
	idIndex.clear();
	heroIndex.clear();
	searchIndex = [];

	// Mark IDB version as stale so _loadCardDatabaseImpl skips IDB on version check
	try { await idb.setCardsVersion('stale'); } catch { /* best-effort */ }

	return loadCardDatabase();
}

async function _loadCardDatabaseImpl(): Promise<Card[]> {
	if (isLoaded && cards.length > 0) return cards;

	// Layer 1: IndexedDB cache

	try {
		const cached = await idb.getCards();
		if (cached && cached.length > 0) {
			const firstItem = cached[0] as Record<string, unknown>;
			const lastItem = cached[cached.length - 1] as Record<string, unknown>;

			// Validate both first and last items to catch truncation/corruption
			const isFirstValid = firstItem && typeof firstItem.id === 'string' && 'card_number' in firstItem && 'name' in firstItem;
			const isLastValid = lastItem && typeof lastItem.id === 'string' && 'card_number' in lastItem && 'name' in lastItem;

			// Also verify the count is reasonable — we expect 17,600+ cards.
			// A very small count indicates a partial write, corruption, or truncation.
			const countReasonable = cached.length > 100;

			if (isFirstValid && isLastValid && countReasonable) {
				cards = cached as Card[];

				// Merge play cards into the index
				const playCards = await loadPlayCards();
				if (playCards.length > 0) {
					cards = cards.concat(playCards);
				}

				buildIndexes();
				invalidateFeaturedCache();
				isLoaded = true;

				// Background refresh from Supabase (non-blocking)
				refreshFromSupabaseInBackground();
				return cards;
			}

			console.warn(`[card-db] IDB cache failed validation: count=${cached.length}, firstValid=${String(isFirstValid)}, lastValid=${String(isLastValid)}, countOk=${countReasonable}. Fetching from Supabase.`);
		}
	} catch (err) {
		console.debug('[card-db] IDB cache read failed:', err);
	}

	// Layer 2: Full fetch from Supabase (first-time load or corrupt IDB)

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
	
					if (data.length < BATCH_SIZE) hasMore = false;
				}
			}

			if (allCards.length > 0) {
				// Merge play cards
				const playCards = await loadPlayCards();
				if (playCards.length > 0) {
					allCards = allCards.concat(playCards);
				}

				cards = allCards;

				buildIndexes();
				invalidateFeaturedCache();
				isLoaded = true;

				// Cache in IDB for offline use
				try {
					await idb.setCards(cards);
					await idb.setMeta('cards-last-sync', new Date().toISOString());
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
			// Paginate in 1k chunks to avoid Supabase's 1,000-row default limit
			const CHUNK = 1000;
			const newCards: Array<Record<string, unknown>> = [];
			let incrError: Error | null = null;
			{
				let offset = 0;
				let done = false;
				while (!done) {
					const { data, error: err } = await supabase
						.from('cards')
						.select('*')
						.gt('updated_at', lastSyncTime)
						.range(offset, offset + CHUNK - 1);
					if (err) { incrError = err as unknown as Error; done = true; }
					else if (!data || data.length === 0) { done = true; }
					else {
						newCards.push(...data);
						offset += CHUNK;
						if (data.length < CHUNK) done = true;
					}
				}
			}
			const error = incrError;
			if (!error && newCards.length > 0) {
				const cardMap = new Map(cards.map(c => [c.id, c]));
				for (const card of newCards) {
					cardMap.set((card as { id: string }).id, card as unknown as Card);
				}
				cards = [...cardMap.values()];
				isIncremental = true;
			} else if (!error && newCards && newCards.length === 0) {
				// No new cards — but check if any cards were deleted
				const { count: remoteCount } = await supabase
					.from('cards')
					.select('*', { count: 'exact', head: true });

				// cards array includes play cards (~409) which aren't in the hero 'cards' table,
			// so exclude them from the comparison to avoid false full-refresh triggers
			const heroCardCount = cards.filter(c => c.hero_name !== null || c.power !== null || c.weapon_type !== null).length;
			if (remoteCount !== null && heroCardCount > remoteCount + 10) {
					console.debug(`[card-db] Local (${cards.length}) exceeds remote (${remoteCount}) — triggering full refresh for cleanup`);
					// Fall through to full refresh below
				} else {
					await idb.setCardsVersion('supabase-' + new Date().toISOString());
					await idb.setMeta('cards-last-sync', new Date().toISOString());
					_refreshFailCount = 0;
					return;
				}
			}
		}

		if (!isIncremental) {
			// Paginated full refresh — Supabase has a default 1,000 row limit.
			// Without pagination, this would silently truncate 17,600+ cards to 1,000.
			const BATCH_SIZE = 1000;
			let allCards: Card[] = [];
			let offset = 0;
			let hasMore = true;

			while (hasMore) {
				const { data, error } = await supabase
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
					if (data.length < BATCH_SIZE) hasMore = false;
				}
			}

			if (allCards.length === 0) return;
			cards = allCards;
		}

		// Re-merge play cards on refresh.
		// Preserve existing play cards if loadPlayCards() fails — on full refresh
		// (non-incremental), cards was replaced with hero-only data, so we must
		// capture existing play cards BEFORE filtering.
		const existingPlayCards = cards.filter(c => c.hero_name === null && c.power === null && c.weapon_type === null);
		const playCards = await loadPlayCards();
		// Strip any existing play cards before re-adding
		cards = cards.filter(c => c.hero_name !== null || c.power !== null || c.weapon_type !== null);
		if (playCards.length > 0) {
			cards = cards.concat(playCards);
		} else if (existingPlayCards.length > 0) {
			// loadPlayCards() failed — restore previously loaded play cards
			console.warn('[card-db] Play card reload returned 0 — restoring previous play cards');
			cards = cards.concat(existingPlayCards);
		} else {
			console.warn('[card-db] Play card reload returned 0 and no existing play cards to restore');
		}

		buildIndexes();
		invalidateFeaturedCache();
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
	searchIndex = [];

	for (const card of cards) {
		if (card.id) idIndex.set(card.id, card);

		const heroKey = (card.hero_name || card.name || '').toUpperCase().trim();
		if (heroKey) {
			if (!heroIndex.has(heroKey)) heroIndex.set(heroKey, []);
			heroIndex.get(heroKey)!.push(card);
		}

		// Pre-compute lowercased search text for faster searching
		const searchText = [
			card.name?.toLowerCase() || '',
			card.hero_name?.toLowerCase() || '',
			card.set_code?.toLowerCase() || '',
			card.card_number?.toLowerCase() || ''
		].join(' ');
		searchIndex.push({ card, searchText });

		const num = normalizeCardNum(card.card_number || '');
		if (!num) continue;

		if (!cardIndex.has(num)) cardIndex.set(num, []);
		cardIndex.get(num)!.push(card);

		const prefix = num.slice(0, 2);
		if (!prefixIndex.has(prefix)) prefixIndex.set(prefix, []);
		prefixIndex.get(prefix)!.push(card);
	}
}

// ── Index accessors (used by card-db-search.ts) ─────────────
export function getCardIndex(): Map<string, Card[]> { return cardIndex; }
export function getPrefixIndex(): Map<string, Card[]> { return prefixIndex; }
export function getHeroIndex(): Map<string, Card[]> { return heroIndex; }
export function getSearchIndex(): Array<{ card: Card; searchText: string }> { return searchIndex; }

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
			// Card number is an exact match but hero name differs.
			// Trust the card number — hero names from OCR/AI are less reliable
			// than card numbers. Log for debugging but return the match.
			console.debug(
				`[card-db] Card number "${normalized}" exact match, hero mismatch: ` +
				`expected="${normalizedHero}", actual name="${card.name}" hero="${card.hero_name}". ` +
				`Returning exact match (card number trusted over hero name).`
			);
		}
		return card;
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


export function getAllCards(): Card[] {
	return cards;
}

export function getCardById(id: string): Card | undefined {
	return idIndex.get(id);
}

