/**
 * Diagnostic logging — server-side entry points.
 *
 * Three exports for callers, in increasing levels of opinionation:
 *
 *   logEvent(input)            — fire-and-forget; writes one row to app_events.
 *                                Used for direct logging from existing catch blocks.
 *   wrap(eventName, fn, ctx)   — wraps an async fn; logs + rethrows on failure,
 *                                logs success at debug level (sample-rate gated).
 *   wrapSilent(name, fn, fallback) — wraps; on failure logs warn-level and
 *                                    returns the fallback instead of throwing.
 *                                    For dynamic imports / optional features.
 *
 * Failure mode: if the admin client isn't configured or the insert fails, we
 * fall back to console.error/warn. Never throws from logEvent/wrap's logging
 * path itself — diagnostic logging must not become a new failure source.
 *
 * Fingerprint hash groups identical occurrences. Computed only for warn/error/
 * fatal — debug/info don't need a triage entry. The hash combines event_name,
 * error_code, and a normalized error message (stack frames stripped).
 */

import { createHash } from 'node:crypto';
import { getAdminClient } from './supabase-admin';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogSource = 'server' | 'client' | 'edge' | 'worker';
export type DiagnosticContext = Record<string, unknown>;

export interface LogEventInput {
	level: LogLevel;
	event: string;
	source?: LogSource;
	error?: unknown;
	errorCode?: string;
	context?: DiagnosticContext;
	userId?: string | null;
	scanId?: string | null;
	requestPath?: string | null;
	vercelRequestId?: string | null;
}

// Sample rate for debug-level wrap() success events. 1.0 = log every success.
// Drop this if AdminTriageTab Storage panel hits Yellow (>200MB).
export const DEBUG_SUCCESS_SAMPLE_RATE = 1.0;

const SUMMARY_MAX_LEN = 200;
const STACK_MAX_LEN = 4000;

interface NormalizedError {
	message: string;
	stack: string | null;
	name: string | null;
	code: string | null;
}

function normalizeError(err: unknown): NormalizedError {
	if (err instanceof Error) {
		const code = (err as Error & { code?: unknown }).code;
		return {
			message: err.message || err.name || 'Error',
			stack: typeof err.stack === 'string' ? err.stack.slice(0, STACK_MAX_LEN) : null,
			name: err.name || null,
			code: typeof code === 'string' || typeof code === 'number' ? String(code) : null
		};
	}
	if (typeof err === 'string') return { message: err, stack: null, name: null, code: null };
	if (err && typeof err === 'object') {
		const obj = err as Record<string, unknown>;
		const message =
			typeof obj.message === 'string'
				? obj.message
				: typeof obj.error === 'string'
					? obj.error
					: JSON.stringify(obj).slice(0, SUMMARY_MAX_LEN);
		return {
			message,
			stack: null,
			name: typeof obj.name === 'string' ? obj.name : null,
			code: typeof obj.code === 'string' || typeof obj.code === 'number' ? String(obj.code) : null
		};
	}
	return { message: String(err), stack: null, name: null, code: null };
}

/**
 * Strip variable bits (UUIDs, numeric IDs, timestamps, paths) from an error
 * message so two occurrences of the same root cause hash to the same key.
 */
function normalizeForFingerprint(message: string): string {
	return message
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
		.replace(/\b\d{10,}\b/g, '<num>')
		.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<ts>')
		.replace(/0x[0-9a-f]+/gi, '<hex>')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 500);
}

function computeFingerprint(eventName: string, errorCode: string | null, normalizedMessage: string): string {
	const key = `${eventName}|${errorCode ?? ''}|${normalizedMessage}`;
	return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function buildSummary(message: string): string {
	return message.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX_LEN);
}

/**
 * Write one diagnostic event. Never throws — logging failures fall back to
 * console.error and return null. Returns the inserted row id on success.
 */
export async function logEvent(input: LogEventInput): Promise<number | null> {
	const { level, event, source = 'server', error, errorCode, context, userId, scanId, requestPath, vercelRequestId } = input;

	const normalized = error !== undefined ? normalizeError(error) : null;
	const finalCode = errorCode ?? normalized?.code ?? null;

	const fingerprintEligible = level === 'warn' || level === 'error' || level === 'fatal';
	const normMessage = normalized ? normalizeForFingerprint(normalized.message) : '';
	const fingerprint = fingerprintEligible ? computeFingerprint(event, finalCode, normMessage) : null;

	const summary = normalized ? buildSummary(normalized.message) : null;

	const errorDetail: Record<string, unknown> | null = normalized
		? {
				message: normalized.message,
				name: normalized.name,
				stack: normalized.stack
		  }
		: null;

	// Always write a structured stderr line. Even if the DB insert fails,
	// Vercel logs preserve the event for the log-mirror cron to ingest later.
	if (level === 'error' || level === 'fatal' || level === 'warn') {
		console.error(
			JSON.stringify({
				type: 'diag_event',
				level,
				event,
				source,
				fingerprint,
				summary,
				error_code: finalCode,
				request_path: requestPath ?? null,
				vercel_request_id: vercelRequestId ?? null
			})
		);
	}

	const admin = getAdminClient();
	if (!admin) return null;

	try {
		// One write — the app_events insert trigger maintains event_fingerprints
		// (upsert + occurrence_count bump + auto-reopen of resolved patterns).
		// See migration 015 app_events_maintain_fingerprint.
		const { data, error: insertErr } = await admin
			.from('app_events')
			.insert({
				level,
				event_name: event,
				source,
				fingerprint_hash: fingerprint,
				summary,
				error_code: finalCode,
				error_detail: errorDetail,
				context: context ?? {},
				user_id: userId ?? null,
				scan_id: scanId ?? null,
				request_path: requestPath ?? null,
				vercel_request_id: vercelRequestId ?? null
			})
			.select('id')
			.single();

		if (insertErr) {
			console.error('[diagnostics] insert failed:', insertErr.message);
			return null;
		}
		return data?.id ?? null;
	} catch (err) {
		console.error('[diagnostics] write threw:', err instanceof Error ? err.message : err);
		return null;
	}
}

/**
 * Wrap an async function with diagnostic logging. On failure, logs at
 * level='error' and rethrows. On success, logs at level='debug' (sampled).
 *
 * Use this at server endpoint entry points and around any function whose
 * failure should be observable.
 */
export async function wrap<T>(
	eventName: string,
	fn: () => Promise<T>,
	context?: DiagnosticContext
): Promise<T> {
	try {
		const result = await fn();
		if (DEBUG_SUCCESS_SAMPLE_RATE >= 1.0 || Math.random() < DEBUG_SUCCESS_SAMPLE_RATE) {
			void logEvent({ level: 'debug', event: `${eventName}.success`, context });
		}
		return result;
	} catch (err) {
		void logEvent({ level: 'error', event: `${eventName}.failed`, error: err, context });
		throw err;
	}
}

// Exported for unit tests — pure helpers, no external dependencies.
export const __testing = {
	normalizeError,
	normalizeForFingerprint,
	computeFingerprint,
	buildSummary
};

/**
 * Wrap an async function whose failure should NOT propagate. On failure, logs
 * at level='warn' and returns the provided fallback.
 *
 * Use for dynamic imports, optional features, telemetry hops, fire-and-forget
 * reads where the caller has already chosen a graceful degradation.
 */
export async function wrapSilent<T>(
	eventName: string,
	fn: () => Promise<T>,
	fallback: T,
	context?: DiagnosticContext
): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		void logEvent({ level: 'warn', event: `${eventName}.failed`, error: err, context });
		return fallback;
	}
}
