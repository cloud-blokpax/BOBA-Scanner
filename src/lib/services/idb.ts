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
const DB_VERSION = 4;

const STORES = {
	cards: 'cards',
	hashCache: 'hash-cache',
	collections: 'collections',
	prices: 'prices',
	meta: 'meta',
	tombstones: 'tombstones',
	scanQueue: 'scan_queue',
	decks: 'decks'
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

export interface QueuedScan {
	id: string;
	imageBlob: Blob;
	timestamp: number;
}

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
			if (!db.objectStoreNames.contains(STORES.scanQueue)) {
				db.createObjectStore(STORES.scanQueue, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(STORES.decks)) {
				db.createObjectStore(STORES.decks, { keyPath: 'id' });
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
		const db = await openDB();
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORES.cards, 'readwrite');
			const store = tx.objectStore(STORES.cards);
			// Clear and repopulate in one transaction — atomic
			store.clear();
			for (const card of cards) {
				store.put(card);
			}
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
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
	async setHash(entry: { phash: string; card_id: string; confidence: number; phash_256?: string; game_id?: string }) {
		// Read existing entry to increment scan_count
		const existing = await get<{ scan_count?: number }>(STORES.hashCache, entry.phash);
		const prevCount = existing?.scan_count || 0;

		await put(STORES.hashCache, {
			...entry,
			game_id: entry.game_id || 'boba',
			scan_count: prevCount + 1,
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

	// Decks
	async getDeck(id: string) {
		return get(STORES.decks, id);
	},
	async saveDeck(deck: { id: string; name: string; formatId: string; heroCardIds: string[]; playEntries: unknown[]; hotDogCount: number; updatedAt: string }) {
		await put(STORES.decks, deck);
	},
	async listDecks() {
		return getAll(STORES.decks);
	},
	async deleteDeck(id: string) {
		const db = await openDB();
		return new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORES.decks, 'readwrite');
			const req = tx.objectStore(STORES.decks).delete(id);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	},

	// Meta
	async getMeta<T>(key: string): Promise<T | undefined> {
		return get(STORES.meta, key);
	},
	async setMeta(key: string, value: unknown) {
		await put(STORES.meta, value, key);
	}
};

// ── Offline scan queue ──────────────────────────────────────

export const scanQueue = {
	async add(blob: Blob): Promise<string> {
		const id = crypto.randomUUID();
		await put(STORES.scanQueue, { id, imageBlob: blob, timestamp: Date.now() } satisfies QueuedScan);
		return id;
	},

	async getAll(): Promise<QueuedScan[]> {
		return getAll<QueuedScan>(STORES.scanQueue);
	},

	async remove(id: string): Promise<void> {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORES.scanQueue, 'readwrite');
			const req = tx.objectStore(STORES.scanQueue).delete(id);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	},

	async count(): Promise<number> {
		const db = await openDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORES.scanQueue, 'readonly');
			const req = tx.objectStore(STORES.scanQueue).count();
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}
};

/**
 * Verify IndexedDB is healthy and accessible. If the database is
 * corrupted or inaccessible, delete it and re-open a fresh one.
 * This handles iOS Safari's tendency to corrupt IDB stores.
 *
 * Call once from the root layout's onMount, before any other IDB access.
 */
export async function verifyIdbHealth(): Promise<'healthy' | 'recovered' | 'unavailable'> {
	try {
		const db = await openDB();

		// Verify we can read/write to the meta store
		const testKey = '__health_check__';
		const tx = db.transaction(STORES.meta, 'readwrite');
		const store = tx.objectStore(STORES.meta);
		store.put({ ts: Date.now() }, testKey);
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		// Clean up the test key
		const cleanTx = db.transaction(STORES.meta, 'readwrite');
		cleanTx.objectStore(STORES.meta).delete(testKey);

		return 'healthy';
	} catch (err) {
		console.warn('[idb] Health check failed, attempting recovery:', err);

		// Reset the cached promise so openDB() creates a fresh connection
		dbPromise = null;

		try {
			// Delete the corrupted database entirely
			await new Promise<void>((resolve, reject) => {
				const req = indexedDB.deleteDatabase(DB_NAME);
				req.onsuccess = () => resolve();
				req.onerror = () => reject(req.error);
				req.onblocked = () => {
					console.warn('[idb] Database deletion blocked — close other tabs');
					resolve(); // Proceed anyway — the next openDB() will retry
				};
			});

			// Re-open a fresh database (triggers onupgradeneeded to recreate stores)
			await openDB();
			console.warn('[idb] Database recovered — all cached data has been cleared');
			return 'recovered';
		} catch (recoveryErr) {
			console.error('[idb] Recovery failed — IndexedDB unavailable:', recoveryErr);
			return 'unavailable';
		}
	}
}

// Request persistent storage to prevent iOS Safari from evicting IndexedDB
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
	navigator.storage.persist().then((granted) => {
		if (granted) console.debug('[idb] Persistent storage granted');
		else console.debug('[idb] Persistent storage denied — data may be evicted');
	}).catch((err) => {
		console.debug('[idb] Persistent storage request failed:', err);
	});
}
