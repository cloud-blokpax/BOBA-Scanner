/**
 * Unit tests for the pure regex-rule helpers inside the Wonders parallel
 * classifier. The bitmap-consuming pieces (edge-density measurement,
 * ocrFullFrame invocation) are covered in integration tests.
 */
import { describe, it, expect, vi } from 'vitest';

// paddle-ocr has side effects at import-time (WASM loader); stub before
// importing the classifier module.
vi.mock('../src/lib/services/paddle-ocr', () => ({
	ocrFullFrame: vi.fn()
}));

import {
	matchOCMSerial,
	matchOneOfOne
} from '../src/lib/services/parallel-classifier';

describe('matchOCMSerial', () => {
	it('detects NN/99 serials', () => {
		expect(matchOCMSerial('66/99')).toBe('66/99');
		expect(matchOCMSerial('1/99')).toBe('1/99');
		expect(matchOCMSerial('99/99')).toBe('99/99');
	});
	it('detects serials embedded in surrounding text', () => {
		// Simulated full-frame OCR output concatenated from boxes
		expect(matchOCMSerial('Cast Out | 66/99 | Shimmering')).toBe('66/99');
	});
	it('tolerates extra whitespace around the slash', () => {
		expect(matchOCMSerial('66 / 99')).toBe('66/99');
		expect(matchOCMSerial('66  /  99')).toBe('66/99');
	});
	it('returns null for non-99 denominators', () => {
		// OCM cards are always /99 in Wonders. /100, /50 etc. are OCR misreads.
		expect(matchOCMSerial('66/100')).toBeNull();
		expect(matchOCMSerial('10/50')).toBeNull();
	});
	it('returns null when no serial appears', () => {
		expect(matchOCMSerial('Cast Out')).toBeNull();
		expect(matchOCMSerial('')).toBeNull();
	});
	it('is case-insensitive on surrounding text (not that it matters)', () => {
		expect(matchOCMSerial('cast out 66/99')).toBe('66/99');
	});
});

describe('matchOneOfOne', () => {
	it('matches the full spelling', () => {
		expect(matchOneOfOne('ONE OF ONE')).toBe(true);
		expect(matchOneOfOne('one of one')).toBe(true);
		expect(matchOneOfOne('One of One')).toBe(true);
	});
	it('matches the OCR-kerned variant where the middle OF is dropped', () => {
		// Phase 2 validation: Stonefoil OCR read "ONEONE" because the
		// gold-on-black kerning made "OF" invisible. The regex accepts both.
		expect(matchOneOfOne('ONEONE')).toBe(true);
		expect(matchOneOfOne('oneone')).toBe(true);
	});
	it('matches when ONEONE is in surrounding box output', () => {
		expect(matchOneOfOne('Cast Out | ONEONE | Shimmering')).toBe(true);
		expect(matchOneOfOne('Cast Out | ONE OF ONE | Shimmering')).toBe(true);
	});
	it('does not match unrelated text', () => {
		expect(matchOneOfOne('Cast Out')).toBe(false);
		expect(matchOneOfOne('one')).toBe(false);
		expect(matchOneOfOne('one or two')).toBe(false);
	});
	it('does not match when OF appears but not between two ONEs', () => {
		expect(matchOneOfOne('PIECE OF EIGHT')).toBe(false);
	});
});
