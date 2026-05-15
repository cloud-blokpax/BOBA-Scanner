/**
 * Unit tests for the scan-failure classifier. Asserts that the strings
 * actually produced by Scanner.svelte, ScanHeroCard, and recognition.ts
 * land in the right kind bucket so ScanFailState can render the right
 * icon/help text.
 */
import { describe, it, expect } from 'vitest';
import { classifyScanFailure } from '../src/lib/utils/scan-fail-classify';

describe('classifyScanFailure', () => {
	it('returns unknown for null/empty input but with a usable title', () => {
		expect(classifyScanFailure(null).kind).toBe('unknown');
		expect(classifyScanFailure('').kind).toBe('unknown');
		expect(classifyScanFailure(undefined).title).toBe('Card Not Identified');
	});

	it('catches blur producers', () => {
		expect(
			classifyScanFailure('Image too blurry — try holding the card steady with better lighting').kind
		).toBe('blur');
	});

	it('catches network/offline producers', () => {
		expect(classifyScanFailure('Offline — scan queued for when you reconnect').kind).toBe('network');
		expect(
			classifyScanFailure('Card database unavailable — please check your connection and try again').kind
		).toBe('network');
	});

	it('catches no_match producers', () => {
		expect(classifyScanFailure('AI could not identify this card').kind).toBe('no_match');
		expect(classifyScanFailure('Could not identify card. Try a clearer photo.').kind).toBe('no_match');
	});

	it('catches image-process failures from Scanner.svelte', () => {
		expect(
			classifyScanFailure('Failed to process image — try a different photo').kind
		).toBe('image');
		expect(
			classifyScanFailure('Image buffer was lost during processing — please try again').kind
		).toBe('image');
	});

	it('falls through generic "Scanner error" to unknown but preserves the message as title', () => {
		const result = classifyScanFailure('Scanner error — please try again');
		expect(result.kind).toBe('unknown');
		expect(result.title).toBe('Scanner error — please try again');
	});

	it('every output has an icon, title, and helpText', () => {
		const cases = [
			null,
			'blurry',
			'glare on the card',
			'overexposed',
			'Offline',
			'AI could not identify',
			'could not read card text',
			'Failed to process image',
			'some weird new error'
		];
		for (const c of cases) {
			const r = classifyScanFailure(c);
			expect(r.icon.length).toBeGreaterThan(0);
			expect(r.title.length).toBeGreaterThan(0);
			expect(r.helpText.length).toBeGreaterThan(0);
		}
	});
});
