/**
 * IndexedDB wrapper for client-side caching.
 *
 * Stores:
 *   - cards: Full card database (cached from Supabase)
 *   - hashCache: Perceptual hash → card ID mappings
 *   - collections: User collection data for offline viewing
 *   - prices: Price cache with TTL
 *   - meta: Version info and metadata
 */

const DB_NAME = 'boba-scanner-v2';
const DB_VERSION = 2;

const STORES = {
	cards: 'cards',
	hashCache: 'hash-cache',
	collections: 'collections',
	prices: 'prices',
	meta: 'meta',
	tombstones: 'tombstones'
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;

			if (!db.objectStoreNames.contains(STORES.cards)) {
				db.createObjectStore(STORES.cards, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(STORES.hashCache)) {
				db.createObjectStore(STORES.hashCache, { keyPath: 'phash' });
			}
			if (!db.objectStoreNames.contains(STORES.collections)) {
				db.createObjectStore(STORES.collections, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(STORES.prices)) {
				const priceStore = db.createObjectStore(STORES.prices, { keyPath: 'card_id' });
				priceStore.createIndex('fetched_at', 'fetched_at');
			}
			if (!db.objectStoreNames.contains(STORES.meta)) {
				db.createObjectStore(STORES.meta);
			}
			if (!db.objectStoreNames.contains(STORES.tombstones)) {
				const tombstoneStore = db.createObjectStore(STORES.tombstones, { keyPath: 'cardId' });
				tombstoneStore.createIndex('deletedAt', 'deletedAt');
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => {
			dbPromise = null;
			reject(request.error);
		};
	});

	return dbPromise;
}

// ── Generic operations ──────────────────────────────────────

async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly');
		const req = tx.objectStore(store).get(key);
		req.onsuccess = () => resolve(req.result as T | undefined);
		req.onerror = () => reject(req.error);
	});
}

async function put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		const req = key
			? tx.objectStore(store).put(value, key)
			: tx.objectStore(store).put(value);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

async function getAll<T>(store: StoreName): Promise<T[]> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readonly');
		const req = tx.objectStore(store).getAll();
		req.onsuccess = () => resolve(req.result as T[]);
		req.onerror = () => reject(req.error);
	});
}

async function clear(store: StoreName): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		const req = tx.objectStore(store).clear();
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

async function bulkPut(store: StoreName, items: unknown[]): Promise<void> {
	const db = await openDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, 'readwrite');
		const objectStore = tx.objectStore(store);
		for (const item of items) {
			objectStore.put(item);
		}
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

// ── Public API ──────────────────────────────────────────────

export const idb = {
	// Cards
	async getCards() {
		return getAll(STORES.cards);
	},
	async setCards(cards: unknown[]) {
		await clear(STORES.cards);
		await bulkPut(STORES.cards, cards);
	},
	async getCardsVersion(): Promise<string | undefined> {
		return get(STORES.meta, 'cards-version');
	},
	async setCardsVersion(version: string) {
		await put(STORES.meta, version, 'cards-version');
	},

	// Hash cache
	async getHash(phash: string) {
		return get(STORES.hashCache, phash);
	},
	async setHash(entry: { phash: string; card_id: string; confidence: number }) {
		await put(STORES.hashCache, {
			...entry,
			scan_count: 1,
			last_seen: new Date().toISOString()
		});
	},

	// Prices (with TTL check)
	async getPrice(cardId: string, maxAgeMs = 3600_000) {
		const entry = await get<{ card_id: string; fetched_at: string }>(STORES.prices, cardId);
		if (!entry) return undefined;
		const age = Date.now() - new Date(entry.fetched_at).getTime();
		return age < maxAgeMs ? entry : undefined;
	},
	async setPrice(priceData: unknown) {
		await put(STORES.prices, priceData);
	},

	// Collections
	async getCollectionItems() {
		return getAll(STORES.collections);
	},
	async setCollectionItems(items: unknown[]) {
		await clear(STORES.collections);
		await bulkPut(STORES.collections, items);
	},

	// Tombstones (for sync deletion tracking)
	async getTombstones(): Promise<Array<{ cardId: string; deletedAt: number }>> {
		return getAll(STORES.tombstones);
	},
	async addTombstone(cardId: string) {
		await put(STORES.tombstones, { cardId, deletedAt: Date.now() });
	},
	async clearTombstones() {
		await clear(STORES.tombstones);
	},

	// Meta
	async getMeta<T>(key: string): Promise<T | undefined> {
		return get(STORES.meta, key);
	},
	async setMeta(key: string, value: unknown) {
		await put(STORES.meta, value, key);
	}
};
