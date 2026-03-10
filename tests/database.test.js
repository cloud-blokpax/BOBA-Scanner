// tests/database.test.js — Tests for card database lookup
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Re-implement core database functions for testing
function normalizeCardNum(val) {
  return String(val).toUpperCase().trim();
}

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: n + 1 }, (_, i) => i);
  for (let j = 1; j <= m; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= n; i++) {
      const temp = dp[i];
      dp[i] = a[j - 1] === b[i - 1]
        ? prev
        : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

let database = [];
let cardIndex = new Map();
let prefixIndex = new Map();

function buildCardIndex() {
  cardIndex.clear();
  prefixIndex.clear();
  for (const card of database) {
    const num = normalizeCardNum(card['Card Number'] || '');
    if (!num) continue;
    if (!cardIndex.has(num)) cardIndex.set(num, []);
    cardIndex.get(num).push(card);
    const prefix = num.slice(0, 2);
    if (!prefixIndex.has(prefix)) prefixIndex.set(prefix, []);
    prefixIndex.get(prefix).push(card);
  }
}

function findCard(cardNumber, heroName = null) {
  if (!cardNumber) return null;
  const normalized = normalizeCardNum(cardNumber);
  const exactMatches = cardIndex.get(normalized) || [];

  if (exactMatches.length === 0) return null;
  if (exactMatches.length === 1) return exactMatches[0];

  // Multiple matches — try hero disambiguation
  if (heroName) {
    const normalizedHero = normalizeCardNum(heroName);
    const heroMatch = exactMatches.find(c =>
      normalizeCardNum(c.Name || '') === normalizedHero
    );
    if (heroMatch) return heroMatch;
  }

  return exactMatches[0]; // fallback
}

function findSimilarCardNumbers(searchNumber, maxDistance = 2) {
  const normalized = normalizeCardNum(searchNumber);
  const prefix = normalized.slice(0, 2);

  const candidateSet = new Set();
  for (const [key, cards] of prefixIndex) {
    if (levenshteinDistance(key, prefix) <= 1) {
      for (const c of cards) candidateSet.add(c);
    }
  }

  const results = [];
  for (const card of candidateSet) {
    const cardNum  = normalizeCardNum(card['Card Number'] || '');
    const distance = levenshteinDistance(normalized, cardNum);
    if (distance <= maxDistance) {
      results.push({ card, cardNumber: cardNum, distance });
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results;
}

beforeAll(() => {
  const dbPath = join(__dirname, '..', 'card-database.json');
  database = JSON.parse(readFileSync(dbPath, 'utf-8'));
  buildCardIndex();
});

describe('Database loading', () => {
  it('loads 17,644 cards', () => {
    expect(database.length).toBe(17644);
  });

  it('builds a non-empty card index', () => {
    expect(cardIndex.size).toBeGreaterThan(0);
  });

  it('builds a non-empty prefix index', () => {
    expect(prefixIndex.size).toBeGreaterThan(0);
  });

  it('each card has required fields', () => {
    const sample = database.slice(0, 50);
    for (const card of sample) {
      expect(card).toHaveProperty('Card ID');
      expect(card).toHaveProperty('Name');
      expect(card).toHaveProperty('Card Number');
    }
  });
});

describe('findCard — exact match', () => {
  it('finds a card by exact card number', () => {
    // Get a known card number from the database
    const knownCard = database.find(c => c['Card Number']);
    if (!knownCard) return; // skip if no cards have numbers

    const found = findCard(knownCard['Card Number']);
    expect(found).not.toBeNull();
    expect(found['Card Number']).toBe(knownCard['Card Number']);
  });

  it('returns null for non-existent card', () => {
    expect(findCard('ZZZ-99999')).toBeNull();
  });

  it('is case-insensitive', () => {
    const knownCard = database.find(c => c['Card Number']);
    if (!knownCard) return;

    const lower = findCard(knownCard['Card Number'].toLowerCase());
    expect(lower).not.toBeNull();
  });
});

describe('findSimilarCardNumbers — fuzzy match', () => {
  it('finds similar card numbers within edit distance 1', () => {
    const knownCard = database.find(c => c['Card Number']?.includes('-'));
    if (!knownCard) return;

    const num = knownCard['Card Number'];
    // Create a 1-edit-distance variant by changing the last digit
    const lastDigit = num.slice(-1);
    const newDigit = lastDigit === '0' ? '1' : '0';
    const variant = num.slice(0, -1) + newDigit;

    const results = findSimilarCardNumbers(variant, 1);
    // Should find the original as a close match
    const match = results.find(r => r.cardNumber === normalizeCardNum(num));
    expect(match).toBeDefined();
  });

  it('returns empty for completely unrelated numbers', () => {
    const results = findSimilarCardNumbers('ZZZZZ-99999', 1);
    expect(results.length).toBe(0);
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('BF-127', 'BF-127')).toBe(0);
  });

  it('returns 1 for single substitution', () => {
    expect(levenshteinDistance('BF-127', 'BF-128')).toBe(1);
  });

  it('returns 1 for single insertion', () => {
    expect(levenshteinDistance('BF-12', 'BF-127')).toBe(1);
  });

  it('returns 1 for single deletion', () => {
    expect(levenshteinDistance('BF-127', 'BF-12')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });
});
