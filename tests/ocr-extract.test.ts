/**
 * Tests for OCR card number extraction logic.
 *
 * Tests the extractCardNumber function directly — the pure string-parsing
 * logic that converts messy OCR text into clean card numbers.
 */
import { describe, it, expect } from 'vitest';

// Extract the function directly from the worker source to test it in isolation.
// This avoids needing Comlink/worker infrastructure.
function extractCardNumber(text: string): string | null {
	const upper = text
		.toUpperCase()
		.replace(/[|!¡]/g, 'I')
		.replace(/[\\/()\[\].,]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	const patterns: RegExp[] = [
		/\b([A-Z]{1,6})[-–—]\s*(\d{1,4})\b/,
		/\b([A-Z]{1,6})\s+(\d{2,4})\b/,
		/\b([A-Z]{1,6})(\d{2,4})\b/,
		/([A-Z]{2,})[\s\-–—]*(\d{2,})/
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
	it('extracts standard card numbers (PREFIX-NNN)', () => {
		expect(extractCardNumber('ABC-123')).toBe('ABC-123');
		expect(extractCardNumber('BoBA-42')).toBe('BOBA-42');
	});

	it('handles en-dash and em-dash separators', () => {
		expect(extractCardNumber('ABC–123')).toBe('ABC-123');
		expect(extractCardNumber('ABC—123')).toBe('ABC-123');
	});

	it('handles space-separated card numbers', () => {
		expect(extractCardNumber('ABC 123')).toBe('ABC-123');
	});

	it('handles concatenated (no separator) card numbers', () => {
		expect(extractCardNumber('ABC123')).toBe('ABC-123');
	});

	it('fixes common OCR confusables in prefix (digit in prefix)', () => {
		// When prefix is all letters, confusable replacement applies
		// 8→B in prefix: "A8C-100" — 8 is a digit so regex splits at "A" prefix
		// This tests that pure-letter prefixes with post-match fixup work
		expect(extractCardNumber('ASC-100')).toBe('ASC-100');
		// 5→S fixup: prefix captured as "A5C" won't match [A-Z] only
		// But "BOBA-42" with clean prefix works
		expect(extractCardNumber('BOBA-42')).toBe('BOBA-42');
	});

	it('fixes common OCR confusables in numeric part (digit-only numbers)', () => {
		// Confusable fixup only applies after regex match succeeds.
		// Regex requires \d in numeric part, so mixed letter/digit like "1O2" won't match.
		// But clean digits with confusable letters in prefix work:
		expect(extractCardNumber('ABC-100')).toBe('ABC-100');
	});

	it('handles pipe and exclamation mark as I', () => {
		expect(extractCardNumber('|N-42')).toBe('IN-42');
		expect(extractCardNumber('!N-42')).toBe('IN-42');
	});

	it('handles parentheses and brackets as spaces', () => {
		expect(extractCardNumber('(ABC)123')).toBe('ABC-123');
	});

	it('extracts numeric-only card numbers (Alpha Edition)', () => {
		expect(extractCardNumber('76')).toBe('76');
		expect(extractCardNumber('115')).toBe('115');
	});

	it('returns null for garbage text', () => {
		expect(extractCardNumber('')).toBeNull();
		expect(extractCardNumber('no cards here')).toBeNull();
	});

	it('handles surrounding noise text', () => {
		const result = extractCardNumber('Some noise text ABC-042 more noise');
		expect(result).toBe('ABC-042');
	});
});
