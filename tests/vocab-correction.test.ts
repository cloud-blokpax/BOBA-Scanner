import { describe, it, expect } from 'vitest';
import { correctAgainstVocab } from '../src/lib/services/vocab-correction';

// Realistic BoBA prefix subset. The full vocab has ~49 entries; for unit
// tests we use a small, deliberately-spaced set so single-edit corrections
// resolve unambiguously. The integration test in consensus-builder covers
// the natural-vocab ambiguity case.
const SPACED_VOCAB = new Set(['BBF', 'RAD', 'GRILL', 'MIX']);

// Full BoBA-like vocab with neighboring 3-letter prefixes; used to validate
// the conservative "ambiguous → null" branch.
const DENSE_VOCAB = new Set([
	'BF', 'BBF', 'HBF', 'IBF', 'SBF', 'ABF', 'RBF', 'BHBF', 'BLBF', 'GLBF'
]);

describe('correctAgainstVocab', () => {
	it('returns exact for items already in the vocab', () => {
		const r = correctAgainstVocab('BBF', SPACED_VOCAB);
		expect(r?.corrected).toBe('BBF');
		expect(r?.source).toBe('exact');
	});
	it('uppercases inputs', () => {
		const r = correctAgainstVocab('bbf', SPACED_VOCAB);
		expect(r?.corrected).toBe('BBF');
		expect(r?.source).toBe('exact');
	});
	it('corrects single-character substitutions in spaced vocab (UBF → BBF)', () => {
		const r = correctAgainstVocab('UBF', SPACED_VOCAB);
		expect(r?.corrected).toBe('BBF');
		expect(r?.source).toBe('edit_1');
	});
	it('corrects digit→letter confusion (8BF → BBF in spaced vocab)', () => {
		const r = correctAgainstVocab('8BF', SPACED_VOCAB);
		expect(r?.corrected).toBe('BBF');
		expect(r?.source).toBe('edit_1');
	});
	it('returns null for ambiguous corrections in dense vocab (UBF distance-1 from many)', () => {
		const r = correctAgainstVocab('UBF', DENSE_VOCAB);
		expect(r).toBeNull();
	});
	it('returns null when no candidates within distance 1', () => {
		const r = correctAgainstVocab('XYZQ', SPACED_VOCAB);
		expect(r).toBeNull();
	});
	it('does not match when distance exceeds 1', () => {
		// "QQ" → distance to BBF is 3, to RAD is 3, to GRILL is 5, to MIX is 3.
		const r = correctAgainstVocab('QQ', SPACED_VOCAB);
		expect(r).toBeNull();
	});
	it('returns null for empty input', () => {
		expect(correctAgainstVocab('', SPACED_VOCAB)).toBeNull();
	});
});
