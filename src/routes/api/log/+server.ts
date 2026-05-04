/**
 * POST /api/log — Legacy client error logging endpoint.
 *
 * Phase 1 Doc 1.2 — rewired to forward into app_events via logEvent. The
 * original implementation wrote to the legacy `error_logs` table, which
 * was dropped during logs consolidation. Existing clients posting the old
 * payload shape continue to work; new clients should target /api/events
 * directly.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logEvent } from '$lib/server/diagnostics';

const logRateMap = new Map<string, { count: number; windowStart: number }>();
const LOG_WINDOW_MS = 60_000;
const MAX_LOG_REQUESTS = 100;

function checkLogRateLimit(ip: string): boolean {
	const now = Date.now();
	const entry = logRateMap.get(ip) || { count: 0, windowStart: now };

	if (now - entry.windowStart > LOG_WINDOW_MS) {
		entry.count = 0;
		entry.windowStart = now;
	}

	if (entry.count >= MAX_LOG_REQUESTS) {
		logRateMap.set(ip, entry);
		return false;
	}

	entry.count++;
	logRateMap.set(ip, entry);

	if (logRateMap.size > 500) {
		for (const [k, v] of logRateMap) {
			if (now - v.windowStart > LOG_WINDOW_MS * 2) logRateMap.delete(k);
		}
		if (logRateMap.size > 1000) {
			const entries = [...logRateMap.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
			const toRemove = entries.slice(0, entries.length - 500);
			for (const [k] of toRemove) logRateMap.delete(k);
		}
	}

	return true;
}

interface ClientError {
	type?: string;
	message?: string;
	file?: string;
	line?: number;
	col?: number;
	stack?: string;
	url?: string;
	ua?: string;
	session?: string;
}

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const clientIp = getClientAddress();
	if (!checkLogRateLimit(clientIp)) {
		return json({ error: 'Too many log requests' }, { status: 429 });
	}

	try {
		let parsed: unknown;
		try {
			parsed = await request.json();
		} catch {
			return json({ error: 'Invalid JSON in request body' }, { status: 400 });
		}

		const errors: ClientError[] | undefined = Array.isArray(parsed)
			? parsed
			: parsed &&
				  typeof parsed === 'object' &&
				  'errors' in parsed &&
				  Array.isArray((parsed as Record<string, unknown>).errors)
				? (parsed as { errors: ClientError[] }).errors
				: undefined;

		if (!Array.isArray(errors) || errors.length === 0) {
			return json({ error: 'Expected array of error objects' }, { status: 400 });
		}

		const batch = errors.slice(0, 50);
		const userId = locals.user?.id ?? null;

		for (const err of batch) {
			const reconstructed = new Error((err.message || '').slice(0, 1000));
			if (err.stack) reconstructed.stack = err.stack.slice(0, 2000);
			Object.assign(reconstructed, {
				file: err.file,
				line: err.line,
				col: err.col
			});

			await logEvent({
				level: 'error',
				event: (err.type || 'client.error').slice(0, 50),
				source: 'client',
				error: reconstructed,
				userId,
				requestPath: err.url ? err.url.slice(0, 500) : null,
				context: {
					user_agent: (err.ua || '').slice(0, 300),
					session_id: (err.session || '').slice(0, 64),
					legacy_endpoint: 'api/log'
				}
			});
		}

		return new Response(null, { status: 204 });
	} catch (err) {
		console.error('Error log handler failed:', err);
		return new Response(null, { status: 500 });
	}
};
