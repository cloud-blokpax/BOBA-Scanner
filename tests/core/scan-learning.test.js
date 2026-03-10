// tests/scan-learning.test.js — Tests for OCR correction learning
import { describe, it, expect, beforeEach } from 'vitest';

// Simulated localStorage
class MockLocalStorage {
  constructor() { this.store = {}; }
  getItem(key) { return this.store[key] || null; }
  setItem(key, value) { this.store[key] = String(value); }
  removeItem(key) { delete this.store[key]; }
  clear() { this.store = {}; }
}

const CORRECTIONS_KEY = 'ocrCorrections';
const MAX_CORRECTIONS = 500;
let storage;

function getCorrections() {
  try {
    return JSON.parse(storage.getItem(CORRECTIONS_KEY) || '{}');
  } catch { return {}; }
}

function saveCorrections(corrections) {
  const keys = Object.keys(corrections);
  if (keys.length > MAX_CORRECTIONS) {
    const toRemove = keys.slice(0, keys.length - MAX_CORRECTIONS);
    for (const key of toRemove) delete corrections[key];
  }
  storage.setItem(CORRECTIONS_KEY, JSON.stringify(corrections));
}

function normalizeOCRText(text) {
  return (text || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function recordCorrection(ocrText, confirmedCardNumber, source) {
  if (!ocrText || !confirmedCardNumber) return;
  const key = normalizeOCRText(ocrText);
  if (key === normalizeOCRText(confirmedCardNumber)) return;
  const corrections = getCorrections();
  corrections[key] = {
    cardNumber: confirmedCardNumber,
    source: source || 'manual',
    hits: 0,
    recorded: Date.now(),
    lastUsed: Date.now()
  };
  saveCorrections(corrections);
}

function checkCorrection(ocrText) {
  if (!ocrText) return null;
  const key = normalizeOCRText(ocrText);
  const corrections = getCorrections();
  const entry = corrections[key];
  if (!entry) return null;
  entry.hits = (entry.hits || 0) + 1;
  entry.lastUsed = Date.now();
  corrections[key] = entry;
  saveCorrections(corrections);
  return entry.cardNumber;
}

beforeEach(() => {
  storage = new MockLocalStorage();
});

describe('recordCorrection', () => {
  it('stores a correction mapping', () => {
    recordCorrection('8F-127', 'BF-127', 'ai');
    const corrections = getCorrections();
    expect(corrections['8F-127']).toBeDefined();
    expect(corrections['8F-127'].cardNumber).toBe('BF-127');
    expect(corrections['8F-127'].source).toBe('ai');
  });

  it('does not record when OCR was already correct', () => {
    recordCorrection('BF-127', 'BF-127', 'ai');
    const corrections = getCorrections();
    expect(Object.keys(corrections)).toHaveLength(0);
  });

  it('ignores null/empty inputs', () => {
    recordCorrection(null, 'BF-127', 'ai');
    recordCorrection('8F-127', null, 'ai');
    recordCorrection('', 'BF-127', 'ai');
    const corrections = getCorrections();
    expect(Object.keys(corrections)).toHaveLength(0);
  });

  it('normalizes to uppercase', () => {
    recordCorrection('bf-127', 'BF-128', 'manual');
    const corrections = getCorrections();
    expect(corrections['BF-127']).toBeDefined();
  });
});

describe('checkCorrection', () => {
  it('returns corrected card number', () => {
    recordCorrection('8F-127', 'BF-127', 'ai');
    const result = checkCorrection('8F-127');
    expect(result).toBe('BF-127');
  });

  it('returns null for unknown OCR text', () => {
    const result = checkCorrection('UNKNOWN-999');
    expect(result).toBeNull();
  });

  it('increments hit counter', () => {
    recordCorrection('8F-127', 'BF-127', 'ai');
    checkCorrection('8F-127');
    checkCorrection('8F-127');
    checkCorrection('8F-127');
    const corrections = getCorrections();
    expect(corrections['8F-127'].hits).toBe(3);
  });

  it('is case-insensitive on lookup', () => {
    recordCorrection('8f-127', 'BF-127', 'ai');
    expect(checkCorrection('8F-127')).toBe('BF-127');
  });

  it('returns null for empty input', () => {
    expect(checkCorrection('')).toBeNull();
    expect(checkCorrection(null)).toBeNull();
  });
});

describe('Pruning', () => {
  it('prunes to MAX_CORRECTIONS entries', () => {
    // Add MAX_CORRECTIONS + 10 entries
    for (let i = 0; i < MAX_CORRECTIONS + 10; i++) {
      recordCorrection(`OCR-${i}`, `CORRECT-${i}`, 'test');
    }
    const corrections = getCorrections();
    expect(Object.keys(corrections).length).toBeLessThanOrEqual(MAX_CORRECTIONS);
  });
});
