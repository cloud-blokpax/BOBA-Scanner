/**
 * Catalog mirror: pulls a minimal card catalog to IndexedDB on app init.
 * Provides in-memory shortlists for fuzzy matching without network cost
 * per scan. Used by the live OCR Tier 1 path (Session 2.1a).
 */

import { openDB, type IDBPDatabase } from 'idb';
import { getSupabase } from './supabase';
import { normalizeOcrName, levenshtein } from '$lib/utils/normalize-ocr-name';

// Re-exported from a side-effect-free module so unit tests can import
// the pure helpers without pulling IDB + Supabase transitively.
export { normalizeOcrName, levenshtein };

const DB_NAME = 'card-scanner-catalog';
const DB_VERSION = 1;
const STORE_CARDS = 'cards';
const STORE_META = 'meta';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export interface MirrorCard {
	id: string;
	game_id: 'boba' | 'wonders' | string;
	card_number: string;
	hero_name: string | null; // BoBA
	name: string | null; // Wonders
	/** Source-of-truth parallel from cards.parallel (human-readable name). */
	parallel: string | null;
	set_code: string | null;
}

let _db: IDBPDatabase | null = null;
let _bobaPrefixes: Set<string> | null = null;
let _bobaHeroes: string[] | null = null;
let _wondersNames: string[] | null = null;
let _warmedAt: number | null = null;
let _warmPromise: Promise<void> | null = null;

async function getDB(): Promise<IDBPDatabase> {
	if (_db) return _db;
	_db = await openDB(DB_NAME, DB_VERSION, {
		upgrade(db) {
			if (!db.objectStoreNames.contains(STORE_CARDS)) {
				const store = db.createObjectStore(STORE_CARDS, { keyPath: 'id' });
				store.createIndex('game_card_hero', ['game_id', 'card_number', 'hero_name']);
				store.createIndex('game_card_name', ['game_id', 'card_number', 'name']);
			}
			if (!db.objectStoreNames.contains(STORE_META)) {
				db.createObjectStore(STORE_META, { keyPath: 'key' });
			}
		}
	});
	return _db;
}

export async function warmCatalog(force = false): Promise<void> {
	// Dedupe concurrent callers.
	if (_warmPromise && !force) return _warmPromise;

	_warmPromise = (async () => {
		try {
			const db = await getDB();
			const meta = await db.get(STORE_META, 'last_warm');
			const now = Date.now();
			if (!force && meta && now - meta.value < MAX_AGE_MS) {
				_warmedAt = meta.value;
				await loadShortlistsFromIDB();
				return;
			}

			// Pull minimal fields only — keep bandwidth tight.
			const client = getSupabase();
			if (!client) {
				// Offline / unconfigured Supabase — load whatever we have cached.
				await loadShortlistsFromIDB();
				return;
			}

			const { data, error } = await client
				.from('cards')
				.select('id, game_id, card_number, hero_name, name, parallel, set_code')
				.in('game_id', ['boba', 'wonders']);

			if (error || !data) {
				console.warn('[catalog-mirror] warm failed, using stale data', error);
				await loadShortlistsFromIDB();
				return;
			}

			const tx = db.transaction([STORE_CARDS, STORE_META], 'readwrite');
			await tx.objectStore(STORE_CARDS).clear();
			for (const card of data as unknown as MirrorCard[]) {
				await tx.objectStore(STORE_CARDS).put(card);
			}
			await tx.objectStore(STORE_META).put({ key: 'last_warm', value: now });
			await tx.done;

			_warmedAt = now;
			await loadShortlistsFromIDB();
			console.debug('[catalog-mirror] warmed with', data.length, 'cards');
		} finally {
			_warmPromise = null;
		}
	})();

	return _warmPromise;
}

async function loadShortlistsFromIDB(): Promise<void> {
	const db = await getDB();
	const all = (await db.getAll(STORE_CARDS)) as MirrorCard[];

	const prefixes = new Set<string>();
	const bobaHeroes = new Set<string>();
	const wondersNames = new Set<string>();

	for (const c of all) {
		if (c.game_id === 'boba') {
			const m = c.card_number?.match(/^([A-Z]+)-/i);
			if (m) prefixes.add(m[1].toUpperCase());
			else if (/^\d+$/.test(c.card_number || '')) prefixes.add('__NUMERIC__');
			if (c.hero_name) bobaHeroes.add(c.hero_name);
		} else if (c.game_id === 'wonders') {
			if (c.name) wondersNames.add(c.name);
		}
	}

	_bobaPrefixes = prefixes;
	_bobaHeroes = Array.from(bobaHeroes);
	_wondersNames = Array.from(wondersNames);
}

export function isCatalogWarm(): boolean {
	return _bobaPrefixes !== null;
}

export function getBobaPrefixes(): Set<string> {
	if (!_bobaPrefixes) throw new Error('catalog not warmed');
	return _bobaPrefixes;
}
export function getBobaHeroes(): string[] {
	if (!_bobaHeroes) throw new Error('catalog not warmed');
	return _bobaHeroes;
}
export function getWondersNames(): string[] {
	if (!_wondersNames) throw new Error('catalog not warmed');
	return _wondersNames;
}

export async function lookupCard(
	game: 'boba' | 'wonders',
	cardNumber: string,
	nameField: string
): Promise<MirrorCard | null> {
	const db = await getDB();
	const indexName = game === 'boba' ? 'game_card_hero' : 'game_card_name';

	// Try the card_number as-given first.
	const match = await db.getFromIndex(STORE_CARDS, indexName, [game, cardNumber, nameField]);
	if (match) return match as MirrorCard;

	// Fall back to the integer prefix when the input is fractional. Wonders
	// physical cards print "316/401"; the catalog indexes "316". Without
	// this fallback, OCR'd fractional reads can never hit the exact index
	// even when name and game are correct.
	if (cardNumber.includes('/')) {
		const integerForm = cardNumber.split('/')[0];
		if (integerForm && integerForm !== cardNumber) {
			const altMatch = await db.getFromIndex(
				STORE_CARDS,
				indexName,
				[game, integerForm, nameField]
			);
			if (altMatch) return altMatch as MirrorCard;
		}
	}

	return null;
}

/**
 * Relaxed lookup: exact card_number match, fuzzy name match against catalog.
 * Used when OCR returned card_number cleanly but the name has OCR artifacts
 * like "CastOut" (missing space) or "A-9o" (0↔o confusion) that keep the
 * exact-index lookup from hitting.
 */
export async function lookupCardByCardNumberFuzzy(
	game: 'boba' | 'wonders',
	cardNumber: string,
	rawName: string
): Promise<MirrorCard | null> {
	const db = await getDB();
	const all = (await db.getAll(STORE_CARDS)) as MirrorCard[];

	// Build the set of card_number forms to consider. Wonders printed cards
	// show fractional ("316/401") while the catalog indexes integer ("316"),
	// so add the integer prefix as a fallback whenever the input is fractional.
	const cnVariants = new Set<string>([cardNumber]);
	if (cardNumber.includes('/')) {
		const integerForm = cardNumber.split('/')[0];
		if (integerForm) cnVariants.add(integerForm);
	}

	const candidates = all.filter(
		(c) => c.game_id === game && cnVariants.has(c.card_number)
	);
	if (candidates.length === 0) return null;
	if (candidates.length === 1) return candidates[0];

	const normalized = normalizeOcrName(rawName);
	let best: { card: MirrorCard; dist: number } | null = null;
	for (const c of candidates) {
		const catalogName = (game === 'boba' ? c.hero_name : c.name) || '';
		const d = levenshtein(normalized, normalizeOcrName(catalogName));
		if (!best || d < best.dist) best = { card: c, dist: d };
	}
	if (!best) return null;
	const catalogName = (game === 'boba' ? best.card.hero_name : best.card.name) || '';
	const threshold = Math.max(2, Math.floor(catalogName.length * 0.2));
	return best.dist <= threshold ? best.card : null;
}

export function catalogWarmedAt(): number | null {
	return _warmedAt;
}
