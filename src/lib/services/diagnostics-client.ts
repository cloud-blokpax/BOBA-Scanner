/**
 * Client-side diagnostic reporter.
 *
 * Browser counterpart to src/lib/server/diagnostics.ts. POSTs events to
 * /api/diag, which forwards them to logEvent on the server.
 *
 * Usage patterns:
 *   - Failure-recovery handlers: replace `console.warn(...)` with `reportClientEvent(...)`
 *   - Window error/rejection handlers: install once at app startup
 *   - Service-failure paths in scan-writer, recognition, etc.
 *
 * Three operational properties:
 *   1. Fire-and-forget — never throws, never blocks the caller.
 *   2. Buffered — events are queued and flushed in batches (or on visibility change).
 *      Buffer size is small; we don't want to lose events to a tab close, but we also
 *      don't want to fire a fetch on every single event.
 *   3. Sendable on unload — uses navigator.sendBeacon when the tab is closing.
 */

import type { LogLevel } from '$lib/server/diagnostics';

interface ClientEvent {
	level: LogLevel;
	event: string;
	error?:
		| { message: string; stack?: string; name?: string; extras?: Record<string, unknown> }
		| string;
	errorCode?: string;
	context?: Record<string, unknown>;
	requestPath?: string;
}

const BUFFER_FLUSH_SIZE = 5;
const BUFFER_FLUSH_INTERVAL_MS = 5_000;
const ENDPOINT = '/api/diag';

let buffer: ClientEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;

function serializeError(err: unknown): ClientEvent['error'] {
	if (err === undefined || err === null) return undefined;
	if (typeof err === 'string') return err;
	if (err instanceof Error) {
		// Capture custom properties from Error subclasses (e.g. StorageApiError
		// has `status` and `statusCode`; PostgrestError has `code`, `details`,
		// `hint`). The base Error type doesn't include these, so we pull them
		// off the runtime object and add them to context for triage.
		const e = err as Error & Record<string, unknown>;
		const extras: Record<string, unknown> = {};
		for (const key of ['status', 'statusCode', 'code', 'details', 'hint', 'errno', 'syscall']) {
			if (key in e && e[key] !== undefined) {
				extras[key] = e[key];
			}
		}
		return {
			message: e.message || e.name,
			stack: typeof e.stack === 'string' ? e.stack.slice(0, 4000) : undefined,
			name: e.name,
			...(Object.keys(extras).length > 0 ? { extras } : {})
		};
	}
	if (typeof err === 'object') {
		const obj = err as Record<string, unknown>;
		const message = typeof obj.message === 'string' ? obj.message : JSON.stringify(obj).slice(0, 500);
		// Same extras capture for plain objects
		const extras: Record<string, unknown> = {};
		for (const key of ['status', 'statusCode', 'code', 'details', 'hint']) {
			if (key in obj && obj[key] !== undefined) {
				extras[key] = obj[key];
			}
		}
		return {
			message,
			name: typeof obj.name === 'string' ? obj.name : undefined,
			...(Object.keys(extras).length > 0 ? { extras } : {})
		};
	}
	return { message: String(err) };
}

function flush(useBeacon = false): void {
	if (buffer.length === 0) return;
	const events = buffer;
	buffer = [];
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}

	const payload = JSON.stringify({ events });

	try {
		if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
			const blob = new Blob([payload], { type: 'application/json' });
			navigator.sendBeacon(ENDPOINT, blob);
			return;
		}
		void fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: payload,
			keepalive: true
		}).catch(() => {
			// Best-effort. If /api/diag is unreachable, the event is lost.
			// We do not retry — retry logic for a logging endpoint risks
			// becoming an infinite loop on the day Supabase is down.
		});
	} catch {
		/* swallow — diagnostics must never throw */
	}
}

function scheduleFlush(): void {
	if (flushTimer) return;
	flushTimer = setTimeout(() => flush(false), BUFFER_FLUSH_INTERVAL_MS);
}

export function reportClientEvent(input: {
	level?: LogLevel;
	event: string;
	error?: unknown;
	errorCode?: string;
	context?: Record<string, unknown>;
}): void {
	if (typeof window === 'undefined') return;

	const e: ClientEvent = {
		level: input.level ?? 'error',
		event: input.event,
		error: serializeError(input.error),
		errorCode: input.errorCode,
		context: input.context,
		requestPath: typeof location !== 'undefined' ? location.pathname : undefined
	};

	buffer.push(e);

	if (buffer.length >= BUFFER_FLUSH_SIZE) {
		flush(false);
	} else {
		scheduleFlush();
	}
}

/**
 * Install global error listeners. Call once at app boot (root +layout.svelte).
 * Idempotent — safe to call multiple times across HMR reloads.
 */
export function installGlobalErrorReporters(): void {
	if (typeof window === 'undefined' || listenersInstalled) return;
	listenersInstalled = true;

	window.addEventListener('error', (ev) => {
		reportClientEvent({
			level: 'error',
			event: 'client.window_error',
			error: ev.error ?? ev.message,
			context: {
				filename: ev.filename,
				line: ev.lineno,
				col: ev.colno
			}
		});
	});

	window.addEventListener('unhandledrejection', (ev) => {
		reportClientEvent({
			level: 'error',
			event: 'client.unhandled_rejection',
			error: ev.reason
		});
	});

	// Flush on tab close / visibility change so pending events aren't lost.
	window.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flush(true);
	});
	window.addEventListener('pagehide', () => flush(true));
}
