// tests/collections.test.js — Tests for collection CRUD operations
import { describe, it, expect, beforeEach } from 'vitest';

// Simulated localStorage for testing
class MockLocalStorage {
  constructor() { this.store = {}; }
  getItem(key) { return this.store[key] || null; }
  setItem(key, value) { this.store[key] = String(value); }
  removeItem(key) { delete this.store[key]; }
  clear() { this.store = {}; }
}

const DEFAULT_COLLECTION = {
  id: 'default',
  name: 'My Collection',
  cards: [],
  stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 }
};

let storage;

function getCollections() {
  try {
    const stored = storage.getItem('collections');
    if (stored && stored !== 'undefined' && stored !== 'null') {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        if (!parsed.find(c => c.id === 'default')) {
          parsed.unshift({ ...DEFAULT_COLLECTION, cards: [], stats: { ...DEFAULT_COLLECTION.stats } });
        }
        return parsed;
      }
    }
  } catch {}
  return [{ ...DEFAULT_COLLECTION, cards: [], stats: { ...DEFAULT_COLLECTION.stats } }];
}

function saveCollections(collections) {
  storage.setItem('collections', JSON.stringify(collections));
}

beforeEach(() => {
  storage = new MockLocalStorage();
});

describe('getCollections', () => {
  it('returns default collection when storage is empty', () => {
    const cols = getCollections();
    expect(cols).toHaveLength(1);
    expect(cols[0].id).toBe('default');
    expect(cols[0].name).toBe('My Collection');
    expect(cols[0].cards).toEqual([]);
  });

  it('returns stored collections', () => {
    const data = [
      { id: 'default', name: 'My Collection', cards: [{ hero: 'Test' }], stats: { scanned: 1 } },
      { id: 'custom', name: 'Custom', cards: [], stats: { scanned: 0 } }
    ];
    storage.setItem('collections', JSON.stringify(data));
    const cols = getCollections();
    expect(cols).toHaveLength(2);
    expect(cols[0].cards).toHaveLength(1);
  });

  it('adds default collection if missing from stored data', () => {
    storage.setItem('collections', JSON.stringify([
      { id: 'custom', name: 'Custom', cards: [], stats: {} }
    ]));
    const cols = getCollections();
    expect(cols.find(c => c.id === 'default')).toBeDefined();
  });

  it('handles corrupted JSON gracefully', () => {
    storage.setItem('collections', 'not valid json {{{');
    const cols = getCollections();
    expect(cols).toHaveLength(1);
    expect(cols[0].id).toBe('default');
  });

  it('handles null/undefined values', () => {
    storage.setItem('collections', 'null');
    expect(getCollections()).toHaveLength(1);

    storage.setItem('collections', 'undefined');
    expect(getCollections()).toHaveLength(1);
  });
});

describe('saveCollections', () => {
  it('persists collections to storage', () => {
    const cols = [{ id: 'default', name: 'Test', cards: [{ hero: 'A' }], stats: {} }];
    saveCollections(cols);
    const stored = JSON.parse(storage.getItem('collections'));
    expect(stored).toHaveLength(1);
    expect(stored[0].cards[0].hero).toBe('A');
  });
});

describe('Collection CRUD', () => {
  it('adds a card to a collection', () => {
    const cols = getCollections();
    cols[0].cards.push({
      hero: 'ACTION',
      cardNumber: 'BF-127',
      set: 'BF',
      year: 2024,
      scanType: 'ocr',
      timestamp: new Date().toISOString()
    });
    cols[0].stats.scanned++;
    saveCollections(cols);

    const loaded = getCollections();
    expect(loaded[0].cards).toHaveLength(1);
    expect(loaded[0].cards[0].hero).toBe('ACTION');
    expect(loaded[0].stats.scanned).toBe(1);
  });

  it('removes a card by index', () => {
    const cols = getCollections();
    cols[0].cards.push({ hero: 'A' }, { hero: 'B' }, { hero: 'C' });
    saveCollections(cols);

    const cols2 = getCollections();
    cols2[0].cards.splice(1, 1); // remove B
    saveCollections(cols2);

    const result = getCollections();
    expect(result[0].cards).toHaveLength(2);
    expect(result[0].cards.map(c => c.hero)).toEqual(['A', 'C']);
  });

  it('creates a new collection', () => {
    const cols = getCollections();
    cols.push({
      id: 'collection_123',
      name: 'Test Collection',
      cards: [],
      stats: { scanned: 0, free: 0, cost: 0, aiCalls: 0 }
    });
    saveCollections(cols);

    const loaded = getCollections();
    expect(loaded).toHaveLength(2);
    expect(loaded[1].name).toBe('Test Collection');
  });

  it('deletes a non-default collection', () => {
    const cols = getCollections();
    cols.push({ id: 'temp', name: 'Temporary', cards: [], stats: {} });
    saveCollections(cols);

    const cols2 = getCollections().filter(c => c.id !== 'temp');
    saveCollections(cols2);

    const result = getCollections();
    expect(result.find(c => c.id === 'temp')).toBeUndefined();
  });
});

describe('Duplicate detection logic', () => {
  it('detects duplicate cards across collections', () => {
    const cols = getCollections();
    const card = { cardId: '123', cardNumber: 'BF-127', hero: 'ACTION' };
    cols[0].cards.push(card);
    cols.push({ id: 'other', name: 'Other', cards: [{ ...card }], stats: {} });
    saveCollections(cols);

    const loaded = getCollections();
    const dupeCount = loaded.reduce((total, col) =>
      total + col.cards.filter(c => c.cardNumber === 'BF-127').length, 0
    );
    expect(dupeCount).toBe(2);
  });
});
