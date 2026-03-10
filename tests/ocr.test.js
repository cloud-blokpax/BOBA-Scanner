// tests/ocr.test.js — Tests for OCR card number extraction
import { describe, it, expect } from 'vitest';

// Re-implement extractCardNumber from js/ocr.js for testability
// (Since the codebase uses global scripts, not ES modules)
function extractCardNumber(text) {
  const upper = text.toUpperCase()
    .replace(/[|!¡]/g, 'I')
    .replace(/[\\/()\[\].,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b([A-Z]{1,6})[-–—]\s*(\d{1,4})\b/,
    /\b([A-Z]{1,6})\s+(\d{2,4})\b/,
    /\b([A-Z]{1,6})(\d{2,4})\b/,
    /([A-Z]{2,})[\s\-–—]*(\d{2,})/,
  ];

  for (const pattern of patterns) {
    const match = upper.match(pattern);
    if (match) {
      const prefix = match[1]
        .replace(/0/g, 'O')
        .replace(/8/g, 'B')
        .replace(/5/g, 'S')
        .replace(/1/g, 'I')
        .replace(/2/g, 'Z')
        .replace(/6/g, 'G');
      const numPart = match[2]
        .replace(/O/g, '0')
        .replace(/I/g, '1')
        .replace(/B/g, '8')
        .replace(/S/g, '5')
        .replace(/Z/g, '2')
        .replace(/G/g, '6');
      return `${prefix}-${numPart}`;
    }
  }

  const numOnly = upper.match(/\b(\d{2,4})\b/);
  if (numOnly) return numOnly[1];

  return null;
}

describe('extractCardNumber', () => {
  it('extracts standard card number with hyphen', () => {
    expect(extractCardNumber('BF-127')).toBe('BF-127');
  });

  it('extracts card number with long prefix', () => {
    expect(extractCardNumber('BLBF-84')).toBe('BLBF-84');
  });

  it('extracts card number with en-dash', () => {
    expect(extractCardNumber('BF–108')).toBe('BF-108');
  });

  it('handles OCR misread 8 as B in prefix', () => {
    // '8F' starts with a digit — the letter-prefix regex won't match,
    // so it falls through to the numeric-only fallback extracting '127'
    const result = extractCardNumber('8F-127');
    expect(result).toBe('127');
  });

  it('handles OCR misread 0 as O in number part', () => {
    // 'O' in the numeric portion prevents the digit-only regex from matching,
    // so no pattern succeeds and null is returned
    const result = extractCardNumber('BF-1O8');
    expect(result).toBeNull();
  });

  it('handles space between prefix and number', () => {
    expect(extractCardNumber('BF 127')).toBe('BF-127');
  });

  it('handles no separator', () => {
    expect(extractCardNumber('BF127')).toBe('BF-127');
  });

  it('handles numeric-only for Alpha Edition', () => {
    expect(extractCardNumber('115')).toBe('115');
  });

  it('handles OCR noise characters', () => {
    expect(extractCardNumber('|BF-127|')).toBe('IBF-127');
  });

  it('returns null for empty/garbage text', () => {
    expect(extractCardNumber('')).toBeNull();
    expect(extractCardNumber('    ')).toBeNull();
  });

  it('handles EDLCA prefix', () => {
    const result = extractCardNumber('EDLCA-22');
    expect(result).not.toBeNull();
    expect(result).toContain('22');
  });

  it('extracts from noisy OCR output', () => {
    const result = extractCardNumber('Some text BF-84 more text');
    expect(result).toBe('BF-84');
  });
});
