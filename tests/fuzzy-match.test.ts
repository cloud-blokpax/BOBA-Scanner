/**
 * Unit tests for fuzzy-match utilities used in card recognition cross-validation.
 */
import { describe, it, expect } from 'vitest';
import { trigramSimilarity, fuzzyNameMatch } from '../src/lib/utils/fuzzy-match';

describe('trigramSimilarity', () => {
	it('returns 1 for identical strings', () => {
		expect(trigramSimilarity('BF-108', 'BF-108')).toBe(1);
	});

	it('returns 1 for identical empty strings', () => {
		expect(trigramSimilarity('', '')).toBe(1);
	});

	it('returns 0 when one string is empty', () => {
		expect(trigramSimilarity('BF-108', '')).toBe(0);
		expect(trigramSimilarity('', 'BF-108')).toBe(0);
	});

	it('returns high similarity for similar card numbers', () => {
		// THA-17 vs THA-7 — close but not identical
		const sim = trigramSimilarity('THA-17', 'THA-7');
		expect(sim).toBeGreaterThan(0.4);
		expect(sim).toBeLessThan(1);
	});

	it('returns low similarity for very different card numbers', () => {
		expect(trigramSimilarity('BF-108', 'PL-46')).toBeLessThan(0.3);
	});

	it('is case-insensitive', () => {
		expect(trigramSimilarity('BF-108', 'bf-108')).toBe(1);
	});

	it('handles prefixes that differ by one character', () => {
		const sim = trigramSimilarity('ABF-10', 'ABF-11');
		expect(sim).toBeGreaterThan(0.5);
	});
});

describe('fuzzyNameMatch', () => {
	it('returns 1 for identical names', () => {
		expect(fuzzyNameMatch('Highway to Helton', 'Highway to Helton')).toBe(1);
	});

	it('is case-insensitive', () => {
		expect(fuzzyNameMatch('HIGHWAY TO HELTON', 'Highway to Helton')).toBe(1);
	});

	it('ignores punctuation', () => {
		expect(fuzzyNameMatch("Highway to Helton!", 'Highway to Helton')).toBe(1);
	});

	it('returns high score when one name contains the other', () => {
		const score = fuzzyNameMatch('Highway to Helton', 'Highway to Helton - Todd Helton Debut');
		expect(score).toBeGreaterThanOrEqual(0.9);
	});

	it('returns high score for very similar names', () => {
		// Simulating a minor OCR misread
		const score = fuzzyNameMatch('Highway to Helton', 'Highway to Heltan');
		expect(score).toBeGreaterThan(0.8);
	});

	it('returns low score for completely different names', () => {
		const score = fuzzyNameMatch('Bo Jackson', 'Ken Griffey Jr');
		expect(score).toBeLessThan(0.5);
	});

	it('handles empty strings', () => {
		expect(fuzzyNameMatch('', '')).toBe(1);
	});

	it('returns 1 for identical after normalization', () => {
		expect(fuzzyNameMatch('  Bo   Jackson  ', 'Bo Jackson')).toBe(1);
	});

	it('detects partial containment of quoted hero names', () => {
		// "The Kid" contained in "The Kid Jr"
		const score = fuzzyNameMatch('The Kid', 'The Kid Jr');
		expect(score).toBeGreaterThanOrEqual(0.9);
	});
});
