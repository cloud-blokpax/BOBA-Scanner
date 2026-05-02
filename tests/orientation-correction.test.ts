import { describe, it, expect } from 'vitest';
import { rotationFromExif } from '../src/lib/services/orientation-correction';

describe('orientation-correction', () => {
	it('maps EXIF tag 1 to 0°', () => {
		expect(rotationFromExif(1)).toBe(0);
	});
	it('maps EXIF tag 3 to 180°', () => {
		expect(rotationFromExif(3)).toBe(180);
	});
	it('maps EXIF tag 6 to 90°', () => {
		expect(rotationFromExif(6)).toBe(90);
	});
	it('maps EXIF tag 8 to 270°', () => {
		expect(rotationFromExif(8)).toBe(270);
	});
	it('returns 0 for null/undefined', () => {
		expect(rotationFromExif(null)).toBe(0);
		expect(rotationFromExif(undefined)).toBe(0);
	});
	it('returns 0 for mirrored variants (Phase 1 punts)', () => {
		expect(rotationFromExif(2)).toBe(0);
		expect(rotationFromExif(4)).toBe(0);
		expect(rotationFromExif(5)).toBe(0);
		expect(rotationFromExif(7)).toBe(0);
	});
	it('returns 0 for unknown values', () => {
		expect(rotationFromExif(99)).toBe(0);
		expect(rotationFromExif(0)).toBe(0);
	});
});
