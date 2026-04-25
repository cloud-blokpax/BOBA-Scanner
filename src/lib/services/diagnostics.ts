/**
 * Client-side diagnostic logging.
 *
 * Three primitives:
 *   - logEvent({ level, event, ... })       — explicit single-event write
 *   - logFailure(eventName, err, context)   — convenience for catch blocks
 *   - wrap(eventName, fn, context)          — auto-log success/failure
 *   - wrapSilent(eventName, fn, fallback)   — convert silent failures to warns
 *
 * Events are POSTed to /api/diag in fire-and-forget fashion via fetch with
 * keepalive (survives page unload). Never blocks the calling code; errors in
 * logging itself are swallowed (intentionally — logging the logger is a pit
 * of recursion).
 *
 * The short_code returned by the server is the basis for the share-to-Claude
 * loop. When it matters (UI surfacing), use the Promise return; otherwise
 * fire-and-forget via `void logEvent({...})`.
 */

import { browser } from '$app/environment';
import { featureEnabled } from '$lib/stores/feature-flags.svelte';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEventInput {
	level: LogLevel;
	event: string;                              // dot-separated event name
	context?: Record<string, unknown>;
	error?: unknown;                            // Error object or string
	errorCode?: string;                         // 'ebay.token_expired' etc
	scanId?: string | null;
	gameId?: string | null;
	requestId?: string | null;
	durationMs?: number;
}

interface ServerLogPayload {
	level: LogLevel;
	event_name: string;
	context: Record<string, unknown>;
	error_message: string | null;
	error_stack: string | null;
	error_code: string | null;
	scan_id: string | null;
	game_id: string | null;
	request_id: string | null;
	duration_ms: number | null;
	client_url: string;
	client_ua: string;
	client_ts: number;
}

/**
 * Generate a 6-char short code. Alphabet excludes 0/O/1/I/l for legibility.
 * Server is the authoritative generator (via DB default), but the client
 * generates one too for fire-and-forget cases where we want a code immediately
 * for UI surfacing without waiting for the server response.
 */
const SHORT_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export function generateShortCode(length = 6): string {
	let out = '';
	const buf = new Uint32Array(length);
	crypto.getRandomValues(buf);
	for (let i = 0; i < length; i++) {
		out += SHORT_CODE_ALPHABET[buf[i] % SHORT_CODE_ALPHABET.length];
	}
	return out;
}

/**
 * Convert any error-like value to (message, stack) strings, capped.
 */
function extractError(err: unknown): { message: string | null; stack: string | null } {
	if (!err) return { message: null, stack: null };
	if (err instanceof Error) {
		return {
			message: err.message.slice(0, 1000),
			stack: (err.stack ?? '').slice(0, 4000)
		};
	}
	return { message: String(err).slice(0, 1000), stack: null };
}

/**
 * Redact known-sensitive keys from a context object before sending.
 * Add new keys here as you discover them.
 */
const REDACT_KEYS = new Set([
	'password', 'secret', 'token', 'access_token', 'refresh_token',
	'api_key', 'apikey', 'authorization', 'auth_header',
	'image_data', 'image_base64', 'photo_data',
	'credit_card', 'cvv', 'ssn'
]);
function redactContext(ctx: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(ctx)) {
		if (REDACT_KEYS.has(k.toLowerCase())) {
			out[k] = '[REDACTED]';
		} else if (v && typeof v === 'object' && !Array.isArray(v)) {
			out[k] = redactContext(v as Record<string, unknown>);
		} else {
			out[k] = v;
		}
	}
	return out;
}

/**
 * Cap context size at 50KB. Anything larger gets truncated with a warning
 * key so we know it happened.
 */
function capContext(ctx: Record<string, unknown>): Record<string, unknown> {
	const json = JSON.stringify(ctx);
	if (json.length <= 50_000) return ctx;
	return {
		_truncated: true,
		_original_size: json.length,
		_preview: json.slice(0, 5000)
	};
}

function buildPayload(input: LogEventInput): ServerLogPayload {
	const errorBits = extractError(input.error);
	const ctx = capContext(redactContext(input.context ?? {}));

	return {
		level: input.level,
		event_name: input.event,
		context: ctx,
		error_message: errorBits.message,
		error_stack: errorBits.stack,
		error_code: input.errorCode ?? null,
		scan_id: input.scanId ?? null,
		game_id: input.gameId ?? null,
		request_id: input.requestId ?? null,
		duration_ms: input.durationMs ?? null,
		client_url: typeof location !== 'undefined' ? location.pathname : '',
		client_ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
		client_ts: Date.now()
	};
}

/**
 * Send to /api/diag. Returns the server-assigned short code if successful,
 * or null if logging failed (this is fire-and-forget — the caller almost
 * never cares about the return).
 */
async function postPayload(payload: ServerLogPayload): Promise<{ shortCode: string } | null> {
	try {
		const body = JSON.stringify(payload);

		const res = await fetch('/api/diag', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
			keepalive: true   // survives page unload
		});
		if (!res.ok) return null;
		const data = await res.json();
		return data?.short_code ? { shortCode: data.short_code } : null;
	} catch {
		return null;
	}
}

/**
 * The primary logging entry point. Returns the short code if you need it
 * for UI surfacing; otherwise call as `void logEvent({...})`.
 *
 * No-ops on the server (this file is client-only) and when the
 * diagnostics_v1 flag is off.
 */
export async function logEvent(input: LogEventInput): Promise<{ shortCode: string } | null> {
	if (!browser) return null;
	if (!featureEnabled('diagnostics_v1')()) return null;

	return postPayload(buildPayload(input));
}

/**
 * Convenience for catch blocks. Always level='error'.
 *
 * Replaces the existing scan-writer logFailure() pattern. Old:
 *   console.debug(`[scan-writer] ${where} failed`, { error })
 * New:
 *   logFailure('scan_writer.update_outcome', err, { scanId })
 */
export function logFailure(
	eventName: string,
	err: unknown,
	context?: Record<string, unknown>
): void {
	void logEvent({
		level: 'error',
		event: eventName,
		error: err,
		context
	});
}

/**
 * Wrap an async operation with auto success/failure logging.
 *
 * Critically: re-throws on failure. This is for adding observability,
 * not changing error handling. Use wrapSilent() for sites that should
 * swallow.
 */
export async function wrap<T>(
	eventName: string,
	fn: () => Promise<T>,
	context?: Record<string, unknown>
): Promise<T> {
	const start = performance.now();
	try {
		const result = await fn();
		void logEvent({
			level: 'debug',
			event: `${eventName}.success`,
			context,
			durationMs: Math.round(performance.now() - start)
		});
		return result;
	} catch (err) {
		void logEvent({
			level: 'error',
			event: `${eventName}.failed`,
			context,
			error: err,
			durationMs: Math.round(performance.now() - start)
		});
		throw err;
	}
}

/**
 * Wrap an async operation that should swallow failures and return a fallback.
 * Logs the swallow at level='warn' so the failure is observable even though
 * the caller chose to ignore it.
 *
 * Use to convert `try {...} catch { /* ignore *\/ }` patterns into observable
 * ones without changing behavior.
 */
export async function wrapSilent<T>(
	eventName: string,
	fn: () => Promise<T>,
	fallback: T,
	context?: Record<string, unknown>
): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		void logEvent({
			level: 'warn',
			event: `${eventName}.recovered`,
			context,
			error: err
		});
		return fallback;
	}
}
