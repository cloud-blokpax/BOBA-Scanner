/**
 * Unit tests for the parallel name/code mapping and assertion helpers
 * used to keep classifier short codes out of the DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	toParallelName,
	toParallelCode,
	assertHumanReadableParallel,
	coerceHumanReadableParallel,
	normalizeParallelForServer,
	WONDERS_PARALLEL_CODE_TO_NAME
} from '../src/lib/data/wonders-parallels';

describe('toParallelName', () => {
	it('maps every short code to its DB name', () => {
		expect(toParallelName('paper')).toBe('Paper');
		expect(toParallelName('cf')).toBe('Classic Foil');
		expect(toParallelName('ff')).toBe('Formless Foil');
		expect(toParallelName('ocm')).toBe('Orbital Color Match');
		expect(toParallelName('sf')).toBe('Stonefoil');
	});
	it('returns null for unknown inputs', () => {
		expect(toParallelName('unknown')).toBeNull();
		expect(toParallelName('battlefoil')).toBeNull();
		expect(toParallelName('')).toBeNull();
		expect(toParallelName(null)).toBeNull();
		expect(toParallelName(undefined)).toBeNull();
	});
});

describe('toParallelCode', () => {
	it('is the inverse of toParallelName for every mapped pair', () => {
		for (const code of Object.keys(WONDERS_PARALLEL_CODE_TO_NAME)) {
			const name = WONDERS_PARALLEL_CODE_TO_NAME[code as keyof typeof WONDERS_PARALLEL_CODE_TO_NAME];
			expect(toParallelCode(name)).toBe(code);
		}
	});
	it('returns null for unknown names', () => {
		expect(toParallelCode('Battlefoil')).toBeNull();
		expect(toParallelCode('not a real parallel')).toBeNull();
	});
});

describe('assertHumanReadableParallel', () => {
	it('throws on every classifier short code', () => {
		expect(() => assertHumanReadableParallel('paper', 'test')).toThrow(/Short parallel code/);
		expect(() => assertHumanReadableParallel('cf', 'test')).toThrow();
		expect(() => assertHumanReadableParallel('ff', 'test')).toThrow();
		expect(() => assertHumanReadableParallel('ocm', 'test')).toThrow();
		expect(() => assertHumanReadableParallel('sf', 'test')).toThrow();
		expect(() => assertHumanReadableParallel('unknown', 'test')).toThrow();
	});
	it('accepts human-readable Wonders names', () => {
		expect(() => assertHumanReadableParallel('Paper', 'test')).not.toThrow();
		expect(() => assertHumanReadableParallel('Classic Foil', 'test')).not.toThrow();
		expect(() => assertHumanReadableParallel('Formless Foil', 'test')).not.toThrow();
		expect(() => assertHumanReadableParallel('Orbital Color Match', 'test')).not.toThrow();
		expect(() => assertHumanReadableParallel('Stonefoil', 'test')).not.toThrow();
	});
	it('passes BoBA parallel values through', () => {
		expect(() => assertHumanReadableParallel('Battlefoil', 'test')).not.toThrow();
		expect(() => assertHumanReadableParallel('RAD', 'test')).not.toThrow();
		expect(() => assertHumanReadableParallel('Headliner', 'test')).not.toThrow();
	});
	it('ignores null/undefined/empty', () => {
		expect(() => assertHumanReadableParallel(null, 'test')).not.toThrow();
		expect(() => assertHumanReadableParallel(undefined, 'test')).not.toThrow();
		expect(() => assertHumanReadableParallel('', 'test')).not.toThrow();
	});
	it('throws on uppercase short codes (case-insensitive match)', () => {
		expect(() => assertHumanReadableParallel('CF', 'test')).toThrow();
		expect(() => assertHumanReadableParallel('SF', 'test')).toThrow();
	});
});

describe('coerceHumanReadableParallel', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;
	beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
	afterEach(() => { warnSpy.mockRestore(); });

	it('maps short codes to DB names and warns', () => {
		expect(coerceHumanReadableParallel('cf', 'test')).toBe('Classic Foil');
		expect(coerceHumanReadableParallel('sf', 'test')).toBe('Stonefoil');
		expect(warnSpy).toHaveBeenCalled();
	});
	it('passes human-readable names through without warning', () => {
		expect(coerceHumanReadableParallel('Classic Foil', 'test')).toBe('Classic Foil');
		expect(coerceHumanReadableParallel('Battlefoil', 'test')).toBe('Battlefoil');
		expect(warnSpy).not.toHaveBeenCalled();
	});
	it('returns null for null input', () => {
		expect(coerceHumanReadableParallel(null, 'test')).toBeNull();
		expect(coerceHumanReadableParallel(undefined, 'test')).toBeNull();
	});
});

describe('normalizeParallelForServer', () => {
	it('maps classifier short codes to DB names', () => {
		expect(normalizeParallelForServer('cf')).toBe('Classic Foil');
		expect(normalizeParallelForServer('ff')).toBe('Formless Foil');
		expect(normalizeParallelForServer('ocm')).toBe('Orbital Color Match');
		expect(normalizeParallelForServer('sf')).toBe('Stonefoil');
		expect(normalizeParallelForServer('paper')).toBe('Paper');
	});
	it('maps snake_case aliases to DB names', () => {
		expect(normalizeParallelForServer('classic_foil')).toBe('Classic Foil');
		expect(normalizeParallelForServer('formless_foil')).toBe('Formless Foil');
		expect(normalizeParallelForServer('stone_foil')).toBe('Stonefoil');
		expect(normalizeParallelForServer('stonefoil')).toBe('Stonefoil');
		expect(normalizeParallelForServer('orbital_color_match')).toBe('Orbital Color Match');
	});
	it('is case-insensitive for aliases', () => {
		expect(normalizeParallelForServer('CF')).toBe('Classic Foil');
		expect(normalizeParallelForServer('Classic_Foil')).toBe('Classic Foil');
	});
	it('passes already-human-readable names through unchanged', () => {
		expect(normalizeParallelForServer('Classic Foil')).toBe('Classic Foil');
		expect(normalizeParallelForServer('Stonefoil')).toBe('Stonefoil');
	});
	it('passes BoBA values through unchanged', () => {
		expect(normalizeParallelForServer('Battlefoil')).toBe('Battlefoil');
		expect(normalizeParallelForServer('Silver Battlefoil')).toBe('Silver Battlefoil');
		expect(normalizeParallelForServer('RAD')).toBe('RAD');
	});
});
