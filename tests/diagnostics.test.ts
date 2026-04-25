/**
 * Unit tests for the pure diagnostics helpers — error normalization,
 * fingerprint hashing, and summary truncation.
 *
 * The logEvent / wrap / wrapSilent paths require a Supabase admin client and
 * are exercised in integration tests; the helpers here are deterministic and
 * cheap to test in isolation.
 */
import { describe, it, expect } from 'vitest';
import { __testing } from '../src/lib/server/diagnostics';

const { normalizeError, normalizeForFingerprint, computeFingerprint, buildSummary } = __testing;

describe('normalizeError', () => {
	it('extracts message and stack from Error instances', () => {
		const err = new Error('something broke');
		const out = normalizeError(err);
		expect(out.message).toBe('something broke');
		expect(out.name).toBe('Error');
		expect(out.stack).toBeTruthy();
	});

	it('truncates very long stacks', () => {
		const err = new Error('x');
		err.stack = 'A'.repeat(10_000);
		const out = normalizeError(err);
		expect(out.stack!.length).toBeLessThanOrEqual(4000);
	});

	it('handles plain string errors', () => {
		const out = normalizeError('boom');
		expect(out.message).toBe('boom');
		expect(out.stack).toBeNull();
	});

	it('extracts message from object errors with .message', () => {
		const out = normalizeError({ message: 'object broke', code: 'EOBJ' });
		expect(out.message).toBe('object broke');
		expect(out.code).toBe('EOBJ');
	});

	it('falls back to JSON for shapeless objects', () => {
		const out = normalizeError({ random: 'object' });
		expect(out.message).toContain('random');
	});

	it('preserves numeric error codes as strings', () => {
		const err = Object.assign(new Error('http'), { code: 503 });
		const out = normalizeError(err);
		expect(out.code).toBe('503');
	});
});

describe('normalizeForFingerprint', () => {
	it('strips UUIDs', () => {
		const a = normalizeForFingerprint('Failed to fetch user a1b2c3d4-e5f6-7890-abcd-ef1234567890 — try again');
		const b = normalizeForFingerprint('Failed to fetch user 12345678-9012-3456-7890-123456789012 — try again');
		expect(a).toBe(b);
	});

	it('strips long numeric IDs', () => {
		const a = normalizeForFingerprint('row 9876543210 not found');
		const b = normalizeForFingerprint('row 1234567890 not found');
		expect(a).toBe(b);
	});

	it('strips ISO timestamps', () => {
		const a = normalizeForFingerprint('Lock acquired at 2026-04-25T18:30:00 expired');
		const b = normalizeForFingerprint('Lock acquired at 2026-04-26T05:15:00 expired');
		expect(a).toBe(b);
	});

	it('strips hex addresses', () => {
		const a = normalizeForFingerprint('Memory error at 0xdeadbeef');
		const b = normalizeForFingerprint('Memory error at 0xfeedface');
		expect(a).toBe(b);
	});

	it('collapses whitespace and trims', () => {
		expect(normalizeForFingerprint('  multi   space\n\nthing ')).toBe('multi space thing');
	});

	it('truncates very long messages', () => {
		expect(normalizeForFingerprint('A'.repeat(2000)).length).toBeLessThanOrEqual(500);
	});
});

describe('computeFingerprint', () => {
	it('is deterministic for identical inputs', () => {
		const a = computeFingerprint('event.foo', 'EOOPS', 'msg');
		const b = computeFingerprint('event.foo', 'EOOPS', 'msg');
		expect(a).toBe(b);
	});

	it('changes with event_name', () => {
		const a = computeFingerprint('event.foo', null, 'msg');
		const b = computeFingerprint('event.bar', null, 'msg');
		expect(a).not.toBe(b);
	});

	it('changes with error_code', () => {
		const a = computeFingerprint('event.foo', 'E1', 'msg');
		const b = computeFingerprint('event.foo', 'E2', 'msg');
		expect(a).not.toBe(b);
	});

	it('changes with normalized message', () => {
		const a = computeFingerprint('event.foo', null, 'msg one');
		const b = computeFingerprint('event.foo', null, 'msg two');
		expect(a).not.toBe(b);
	});

	it('produces a fixed-length hex string', () => {
		const fp = computeFingerprint('e', null, 'm');
		expect(fp).toMatch(/^[0-9a-f]{16}$/);
	});

	it('treats null and missing error_code identically', () => {
		expect(computeFingerprint('e', null, 'm')).toBe(computeFingerprint('e', null, 'm'));
	});
});

describe('buildSummary', () => {
	it('collapses whitespace', () => {
		expect(buildSummary('  too   much\n\nspace ')).toBe('too much space');
	});

	it('truncates long messages', () => {
		expect(buildSummary('A'.repeat(500)).length).toBeLessThanOrEqual(200);
	});
});

describe('fingerprint stability across UUIDs', () => {
	it('two errors that differ only by request UUID produce the same fingerprint', () => {
		const e1 = normalizeError(new Error('Request abc12345-6789-0123-4567-89abcdef0123 timed out'));
		const e2 = normalizeError(new Error('Request fedcba98-7654-3210-fedc-ba9876543210 timed out'));
		const fp1 = computeFingerprint('request.timeout', null, normalizeForFingerprint(e1.message));
		const fp2 = computeFingerprint('request.timeout', null, normalizeForFingerprint(e2.message));
		expect(fp1).toBe(fp2);
	});
});
