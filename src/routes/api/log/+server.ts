/**
 * POST /api/log — DEPRECATED
 *
 * This endpoint accepted the legacy error_logs payload shape. It now
 * forwards each error to /api/diag (app_events). Slated for deletion
 * in a follow-up release once we confirm no cached service-workers are
 * still pointing here.
 *
 * NEW CALLERS: use src/lib/services/diagnostics.ts → logEvent() instead.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

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

export const POST: RequestHandler = async ({ request, fetch }) => {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return new Response(null, { status: 400 });
	}

	const errors: ClientError[] = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === 'object' && 'errors' in parsed && Array.isArray((parsed as Record<string, unknown>).errors)
			? (parsed as { errors: ClientError[] }).errors
			: [];

	for (const err of errors.slice(0, 50)) {
		await fetch('/api/diag', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				level: 'error',
				event_name: err.type === 'metric' ? 'client.metric' : 'client.legacy_error_log',
				error_message: err.message ?? null,
				error_stack: err.stack ?? null,
				context: {
					file: err.file,
					line: err.line,
					col: err.col,
					url: err.url,
					ua: err.ua,
					session: err.session
				}
			})
		}).catch(() => { /* swallow */ });
	}

	return json({ ok: true, deprecated: true });
};
