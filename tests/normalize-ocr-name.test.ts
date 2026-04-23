/**
 * Unit tests for the OCR name normalization helpers that sit at the
 * center of the live-OCR consensus collapse and the fuzzy catalog lookup.
 */
import { describe, it, expect } from 'vitest';
import { normalizeOcrName, levenshtein } from '../src/lib/utils/normalize-ocr-name';

describe('normalizeOcrName', () => {
	it('is lower-case, space-stripped', () => {
		expect(normalizeOcrName('Cast Out')).toBe('cast0ut');
		expect(normalizeOcrName('CastOut')).toBe('cast0ut');
		expect(normalizeOcrName('CAST OUT')).toBe('cast0ut');
	});
	it('collapses space drops in kerned titles', () => {
		// The key Phase 2 validation quirk: "CastOut" and "Cast Out" must
		// collide so fuzzy lookup hits the catalog despite OCR missing the
		// kerned space.
		expect(normalizeOcrName('Cast Out')).toBe(normalizeOcrName('CastOut'));
		expect(normalizeOcrName('Bo Jackson')).toBe(normalizeOcrName('BoJackson'));
	});
	it('collapses 0↔o confusion', () => {
		expect(normalizeOcrName('A-90')).toBe(normalizeOcrName('A-9o'));
		expect(normalizeOcrName('Tofu')).toBe(normalizeOcrName('T0fu'));
	});
	it('collapses 1↔l confusion', () => {
		expect(normalizeOcrName('Hello')).toBe(normalizeOcrName('Hel1o'));
		expect(normalizeOcrName('L337')).toBe(normalizeOcrName('l337'));
	});
	it('stacks all three normalizations', () => {
		expect(normalizeOcrName('OneOfOne')).toBe('0ne0f0ne');
		expect(normalizeOcrName('One Of One')).toBe('0ne0f0ne');
	});
	it('is stable under multiple calls (idempotent)', () => {
		const once = normalizeOcrName('CastOut');
		const twice = normalizeOcrName(once);
		expect(once).toBe(twice);
	});
});

describe('levenshtein', () => {
	it('is 0 for identical strings', () => {
		expect(levenshtein('castout', 'castout')).toBe(0);
	});
	it('counts insertions', () => {
		expect(levenshtein('cat', 'cats')).toBe(1);
	});
	it('counts deletions', () => {
		expect(levenshtein('cats', 'cat')).toBe(1);
	});
	it('counts substitutions', () => {
		expect(levenshtein('cat', 'bat')).toBe(1);
	});
	it('handles empty strings', () => {
		expect(levenshtein('', '')).toBe(0);
		expect(levenshtein('', 'abc')).toBe(3);
		expect(levenshtein('abc', '')).toBe(3);
	});
	it('is symmetric', () => {
		expect(levenshtein('Cast Out', 'CastOut')).toBe(levenshtein('CastOut', 'Cast Out'));
	});
});
