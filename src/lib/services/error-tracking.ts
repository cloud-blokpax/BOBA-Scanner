/**
 * Client-side error tracking service.
 *
 * Captures unhandled errors and promise rejections, batches them,
 * and sends to /api/log via sendBeacon. Privacy-respecting — no PII.
 *
 * Call initErrorTracking() once from the root layout's onMount.
 */

import { browser } from '$app/environment';

interface ErrorPayload {
	type: string;
	message: string;
	file: string;
	line: number;
	col: number;
	stack: string;
	url: string;
	ua: string;
	ts: number;
	session: string;
}

const ERROR_QUEUE: ErrorPayload[] = [];
const MAX_QUEUE = 10;
const FLUSH_INTERVAL = 30_000;

let _sessionId = '';
let _flushInterval: ReturnType<typeof setInterval> | null = null;

function getSessionId(): string {
	if (!_sessionId) {
		_sessionId = Math.random().toString(36).slice(2, 10);
	}
	return _sessionId;
}

function createPayload(
	type: string,
	data: { message?: string; file?: string; line?: number; col?: number; stack?: string }
): ErrorPayload {
	return {
		type,
		message: (data.message || '').slice(0, 500),
		file: (data.file || '').replace(location.origin, ''),
		line: data.line || 0,
		col: data.col || 0,
		stack: (data.stack || '').slice(0, 800),
		url: location.pathname,
		ua: navigator.userAgent.slice(0, 200),
		ts: Date.now(),
		session: getSessionId()
	};
}

function queueError(payload: ErrorPayload): void {
	// Flush BEFORE pushing if at capacity to prevent exceeding MAX_QUEUE
	if (ERROR_QUEUE.length >= MAX_QUEUE) {
		flushErrors();
	}
	ERROR_QUEUE.push(payload);
}

function flushErrors(): void {
	if (ERROR_QUEUE.length === 0) return;
	const batch = ERROR_QUEUE.splice(0, MAX_QUEUE);
	try {
		const blob = new Blob([JSON.stringify(batch)], { type: 'application/json' });
		navigator.sendBeacon('/api/log', blob);
	} catch (err) {
		console.debug('[error-tracking] sendBeacon failed:', err);
	}
}

function onError(event: ErrorEvent): void {
	queueError(
		createPayload('error', {
			message: event.message,
			file: event.filename,
			line: event.lineno,
			col: event.colno,
			stack: event.error?.stack
		})
	);
}

function onRejection(event: PromiseRejectionEvent): void {
	const reason = event.reason;
	queueError(
		createPayload('unhandled_rejection', {
			message: reason instanceof Error ? reason.message : String(reason).slice(0, 500),
			stack: reason instanceof Error ? reason.stack : ''
		})
	);
}

function onVisibilityChange(): void {
	if (document.visibilityState === 'hidden') flushErrors();
}

/**
 * Initialize error tracking. Call once from root layout onMount.
 * Returns a cleanup function.
 */
export function initErrorTracking(): () => void {
	if (!browser) return () => {};

	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
	document.addEventListener('visibilitychange', onVisibilityChange);
	_flushInterval = setInterval(flushErrors, FLUSH_INTERVAL);

	return () => {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onRejection);
		document.removeEventListener('visibilitychange', onVisibilityChange);
		if (_flushInterval) clearInterval(_flushInterval);
		flushErrors(); // Final flush on cleanup
	};
}

/**
 * Track a scan performance metric.
 */
export function trackScanMetric(metric: Record<string, unknown>): void {
	if (!browser) return;
	queueError(createPayload('metric', { message: JSON.stringify(metric) }));
}
