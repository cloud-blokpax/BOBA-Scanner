/**
 * Unit tests for the position-aware regex-rule helpers inside the Wonders
 * parallel classifier. The bitmap-consuming pieces (edge-density measurement,
 * ocrFullFrame invocation) are covered in integration tests.
 */
import { describe, it, expect, vi } from 'vitest';

// paddle-ocr has side effects at import-time (WASM loader); stub before
// importing the classifier module.
vi.mock('../src/lib/services/paddle-ocr', async () => {
	const actual = await vi.importActual<
		typeof import('../src/lib/services/paddle-ocr')
	>('../src/lib/services/paddle-ocr');
	return {
		...actual,
		ocrFullFrame: vi.fn()
	};
});

import {
	matchOCMSerial,
	matchOneOfOne
} from '../src/lib/services/parallel-classifier';
import type { OCRBox } from '../src/lib/services/paddle-ocr';

// Synthetic bitmap dimensions used throughout — values are arbitrary,
// what matters is the relationship between box centroids and the bitmap.
const BMP_W = 1000;
const BMP_H = 1500;

/** Build a left-edge OCR box centered at the given normalized coords. */
function leftEdgeBox(text: string, score: number, normX = 0.05, normY = 0.3): OCRBox {
	const cx = normX * BMP_W;
	const cy = normY * BMP_H;
	return {
		text,
		score,
		box: [
			[cx - 30, cy - 15],
			[cx + 30, cy - 15],
			[cx + 30, cy + 15],
			[cx - 30, cy + 15]
		]
	};
}

/** Build a bottom-of-card OCR box (where Wonders card_numbers live). */
function bottomBox(text: string, score: number): OCRBox {
	const cx = 0.5 * BMP_W;
	const cy = 0.95 * BMP_H;
	return {
		text,
		score,
		box: [
			[cx - 60, cy - 20],
			[cx + 60, cy - 20],
			[cx + 60, cy + 20],
			[cx - 60, cy + 20]
		]
	};
}

describe('matchOCMSerial', () => {
	it('detects /99 serials on the left edge', () => {
		expect(matchOCMSerial([leftEdgeBox('66/99', 0.97)], BMP_W, BMP_H)).toBe('66/99');
		expect(matchOCMSerial([leftEdgeBox('1/99', 0.95)], BMP_W, BMP_H)).toBe('1/99');
		expect(matchOCMSerial([leftEdgeBox('99/99', 0.96)], BMP_W, BMP_H)).toBe('99/99');
	});

	it('detects any print-run denominator on the left edge', () => {
		expect(matchOCMSerial([leftEdgeBox('12/50', 0.95)], BMP_W, BMP_H)).toBe('12/50');
		expect(matchOCMSerial([leftEdgeBox('3/10', 0.95)], BMP_W, BMP_H)).toBe('3/10');
		expect(matchOCMSerial([leftEdgeBox('247/250', 0.95)], BMP_W, BMP_H)).toBe('247/250');
		expect(matchOCMSerial([leftEdgeBox('45/75', 0.95)], BMP_W, BMP_H)).toBe('45/75');
	});

	it('tolerates extra whitespace around the slash', () => {
		expect(matchOCMSerial([leftEdgeBox('66 / 99', 0.95)], BMP_W, BMP_H)).toBe('66/99');
		expect(matchOCMSerial([leftEdgeBox('66  /  99', 0.95)], BMP_W, BMP_H)).toBe('66/99');
	});

	it('rejects card_number boxes at the bottom of the card', () => {
		// Wonders card_number "316/401" prints horizontally at the bottom — must
		// NOT be classified as an OCM serial even though it's a fractional read.
		expect(matchOCMSerial([bottomBox('316/401', 0.99)], BMP_W, BMP_H)).toBeNull();
	});

	it('rejects fractional reads outside the left-edge column', () => {
		// Same fraction text, but centered in the card body (x > 0.15) — not OCM.
		const center: OCRBox = {
			text: '316/401',
			score: 0.99,
			box: [
				[400, 800],
				[600, 800],
				[600, 850],
				[400, 850]
			]
		};
		expect(matchOCMSerial([center], BMP_W, BMP_H)).toBeNull();
	});

	it('rejects nonsense fractions where numerator > denominator', () => {
		expect(matchOCMSerial([leftEdgeBox('999/1', 0.95)], BMP_W, BMP_H)).toBeNull();
		expect(matchOCMSerial([leftEdgeBox('401/316', 0.95)], BMP_W, BMP_H)).toBeNull();
	});

	it('returns null when no fractional pattern is present', () => {
		expect(matchOCMSerial([leftEdgeBox('Cast Out', 0.9)], BMP_W, BMP_H)).toBeNull();
		expect(matchOCMSerial([], BMP_W, BMP_H)).toBeNull();
	});

	it('finds the serial when it sits among other left-edge boxes', () => {
		const boxes: OCRBox[] = [
			leftEdgeBox('SHIMMERING', 0.92, 0.05, 0.2),
			leftEdgeBox('66/99', 0.97, 0.05, 0.4)
		];
		expect(matchOCMSerial(boxes, BMP_W, BMP_H)).toBe('66/99');
	});
});

describe('matchOneOfOne', () => {
	it('matches the full spelling on the left edge', () => {
		expect(matchOneOfOne([leftEdgeBox('ONE OF ONE', 0.95)], BMP_W, BMP_H)).toBe(true);
		expect(matchOneOfOne([leftEdgeBox('one of one', 0.95)], BMP_W, BMP_H)).toBe(true);
		expect(matchOneOfOne([leftEdgeBox('One of One', 0.95)], BMP_W, BMP_H)).toBe(true);
	});

	it('matches the OCR-kerned variant where the middle OF is dropped', () => {
		// Phase 2 validation: Stonefoil OCR read "ONEONE" because the
		// gold-on-black kerning made "OF" invisible.
		expect(matchOneOfOne([leftEdgeBox('ONEONE', 0.99)], BMP_W, BMP_H)).toBe(true);
		expect(matchOneOfOne([leftEdgeBox('oneone', 0.99)], BMP_W, BMP_H)).toBe(true);
	});

	it('does not match unrelated text on the left edge', () => {
		expect(matchOneOfOne([leftEdgeBox('Cast Out', 0.95)], BMP_W, BMP_H)).toBe(false);
		expect(matchOneOfOne([leftEdgeBox('one', 0.95)], BMP_W, BMP_H)).toBe(false);
		expect(matchOneOfOne([leftEdgeBox('one or two', 0.95)], BMP_W, BMP_H)).toBe(false);
	});

	it('does not match when OF appears but not between two ONEs', () => {
		expect(matchOneOfOne([leftEdgeBox('PIECE OF EIGHT', 0.95)], BMP_W, BMP_H)).toBe(false);
	});

	it('rejects matches outside the left edge', () => {
		// Even valid "ONE OF ONE" text shouldn't fire if it's centered in the body.
		const center: OCRBox = {
			text: 'ONE OF ONE',
			score: 0.95,
			box: [
				[400, 800],
				[600, 800],
				[600, 850],
				[400, 850]
			]
		};
		expect(matchOneOfOne([center], BMP_W, BMP_H)).toBe(false);
	});
});
