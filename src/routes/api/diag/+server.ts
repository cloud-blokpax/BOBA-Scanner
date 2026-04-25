/**
 * POST /api/diag — client-side diagnostic event ingestion.
 *
 * Receives one or more diagnostic events from the browser (window.onerror,
 * unhandledrejection, fetch failure handlers, fire-and-forget catches that
 * have been migrated to logEvent) and forwards them to logEvent so they land
 * in app_events alongside server-originated events.
 *
 * Auth: open to authenticated AND anonymous users — client errors from logged-out
 * sessions are valuable (login flow failures, public page crashes). IP-based
 * rate limit prevents abuse.
 *
 * Body shape: { events: Array<{ level, event, error?, errorCode?, context? }> }
 *
 * The endpoint is intentionally permissive — it accepts any JSON-serializable
 * context and unknown event names. Garbage gets logged at level='warn' as
 * 'client.invalid_payload' and dropped.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, rateLimited } from '$lib/server/api-response';
import { checkDiagRateLimit } from '$lib/server/rate-limit';
import { logEvent, type LogLevel } from '$lib/server/diagnostics';

interface ClientEventInput {
	level?: LogLevel;
	event?: string;
	error?:
		| { message?: string; stack?: string; name?: string; extras?: Record<string, unknown> }
		| string;
	errorCode?: string;
	context?: Record<string, unknown>;
	requestPath?: string;
}

const MAX_EVENTS_PER_REQUEST = 20;
const VALID_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const ip = getClientAddress();
	const rl = await checkDiagRateLimit(ip);
	if (!rl.success) return rateLimited(rl);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return apiError('Invalid JSON body', 400, { code: 'INVALID_JSON' });
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return apiError('Body must be an object', 400, { code: 'INVALID_BODY' });
	}

	const events = (body as { events?: unknown }).events;
	if (!Array.isArray(events) || events.length === 0) {
		return apiError('Body must contain a non-empty events array', 400, { code: 'NO_EVENTS' });
	}
	if (events.length > MAX_EVENTS_PER_REQUEST) {
		return apiError(`Too many events (max ${MAX_EVENTS_PER_REQUEST})`, 400, { code: 'TOO_MANY_EVENTS' });
	}

	const userId = locals.user?.id ?? null;

	let accepted = 0;
	let rejected = 0;

	for (const raw of events) {
		if (!raw || typeof raw !== 'object') {
			rejected++;
			continue;
		}
		const e = raw as ClientEventInput;
		const level = e.level && VALID_LEVELS.includes(e.level) ? e.level : 'error';
		const eventName = typeof e.event === 'string' && e.event.length > 0 && e.event.length < 200
			? e.event
			: 'client.unspecified';

		// Reconstruct an Error-shaped object for logEvent's normalizer.
		// Extras (StorageApiError.status, PostgrestError.code/details/hint, etc.)
		// are copied as own properties so normalizeError picks them up the same
		// way it would for a server-side StorageApiError.
		let error: unknown = undefined;
		if (typeof e.error === 'string') {
			error = e.error;
		} else if (e.error && typeof e.error === 'object') {
			const reconstructed = new Error(e.error.message || 'client error');
			if (e.error.stack) reconstructed.stack = e.error.stack;
			if (e.error.name) reconstructed.name = e.error.name;
			if (e.error.extras && typeof e.error.extras === 'object') {
				Object.assign(reconstructed, e.error.extras);
			}
			error = reconstructed;
		}

		const id = await logEvent({
			level,
			event: eventName,
			source: 'client',
			error,
			errorCode: typeof e.errorCode === 'string' ? e.errorCode : undefined,
			context: e.context && typeof e.context === 'object' ? e.context : undefined,
			userId,
			requestPath: typeof e.requestPath === 'string' ? e.requestPath : null
		});

		if (id !== null) accepted++; else rejected++;
	}

	return json({ accepted, rejected });
};
