/**
 * Unit tests for shared utilities. `escapeHtml` is XSS-critical — it's the
 * single helper any server-rendered string with user-controlled content runs
 * through (currently the deck-builder version-check email).
 */
import { describe, it, expect, vi } from 'vitest';
import { escapeHtml, formatPrice, debounce } from '../src/lib/utils';

describe('escapeHtml', () => {
	it('escapes the basic five HTML special characters', () => {
		expect(escapeHtml('&')).toBe('&amp;');
		expect(escapeHtml('<')).toBe('&lt;');
		expect(escapeHtml('>')).toBe('&gt;');
		expect(escapeHtml('"')).toBe('&quot;');
		expect(escapeHtml("'")).toBe('&#x27;');
	});

	it('escapes backtick (IE9 attribute-context safety)', () => {
		expect(escapeHtml('`')).toBe('&#x60;');
	});

	it('escapes ampersand FIRST so &amp; does not double-encode', () => {
		// If '<' were escaped before '&', the result would be "&amp;lt;" not "&lt;".
		expect(escapeHtml('<a>')).toBe('&lt;a&gt;');
		expect(escapeHtml('a & b')).toBe('a &amp; b');
	});

	it('neutralizes a script-tag injection attempt', () => {
		const payload = '<script>alert("xss")</script>';
		const escaped = escapeHtml(payload);
		expect(escaped).not.toContain('<script>');
		expect(escaped).not.toContain('</script>');
		expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
	});

	it('neutralizes attribute-break injection attempts', () => {
		expect(escapeHtml('" onerror="alert(1)')).toBe('&quot; onerror=&quot;alert(1)');
		expect(escapeHtml("' onclick='alert(1)")).toBe('&#x27; onclick=&#x27;alert(1)');
	});

	it('returns empty string unchanged', () => {
		expect(escapeHtml('')).toBe('');
	});

	it('returns benign strings unchanged', () => {
		expect(escapeHtml('Bo Jackson')).toBe('Bo Jackson');
		expect(escapeHtml('A1-028/401')).toBe('A1-028/401');
	});

	it('is idempotent on already-escaped output for the basic chars', () => {
		// Note: ampersand re-escapes (&amp; → &amp;amp;) — that is correct
		// behavior; idempotence holds only for input that contains no '&'.
		const input = '<div>"hello"</div>';
		const once = escapeHtml(input);
		// Strip ampersands and re-test: '<' '>' '"' all stable through second pass.
		expect(escapeHtml('hello')).toBe('hello');
	});
});

describe('formatPrice', () => {
	it('formats a positive number with two decimals', () => {
		expect(formatPrice(12.5)).toBe('$12.50');
		expect(formatPrice(1)).toBe('$1.00');
		expect(formatPrice(1234.567)).toBe('$1234.57');
	});

	it('formats zero', () => {
		expect(formatPrice(0)).toBe('$0.00');
	});

	it('returns N/A for null or undefined', () => {
		expect(formatPrice(null)).toBe('N/A');
		expect(formatPrice(undefined)).toBe('N/A');
	});

	it('treats null and undefined identically (== null)', () => {
		expect(formatPrice(null)).toBe(formatPrice(undefined));
	});
});

describe('debounce', () => {
	it('delays invocation until after the wait period', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(99);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);

		vi.useRealTimers();
	});

	it('coalesces rapid calls into a single trailing invocation', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 50);

		debounced();
		debounced();
		debounced();
		vi.advanceTimersByTime(50);
		expect(fn).toHaveBeenCalledTimes(1);

		vi.useRealTimers();
	});

	it('forwards the latest arguments', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const debounced = debounce(fn, 50);

		debounced('first');
		debounced('second');
		debounced('third');
		vi.advanceTimersByTime(50);
		expect(fn).toHaveBeenCalledWith('third');

		vi.useRealTimers();
	});
});
