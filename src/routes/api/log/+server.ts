/**
 * POST /api/log — Client error logging endpoint
 *
 * Receives batched error logs and stores in Supabase error_logs table.
 * Falls back to console logging when Supabase is unavailable.
 */

import { json } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

// Simple IP-based rate limit for unauthenticated error logging (100 per minute)
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

	// Check limit BEFORE incrementing to avoid off-by-one
	if (entry.count >= MAX_LOG_REQUESTS) {
		logRateMap.set(ip, entry);
		return false;
	}

	entry.count++;
	logRateMap.set(ip, entry);

	// Periodic cleanup — evict expired entries and hard-cap to prevent unbounded growth
	if (logRateMap.size > 500) {
		for (const [k, v] of logRateMap) {
			if (now - v.windowStart > LOG_WINDOW_MS * 2) logRateMap.delete(k);
		}
		// Hard cap: if still too large after expiry cleanup, remove oldest entries
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

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	// Rate limit by IP to prevent log spam
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

		// Accept both array (legacy client) and { errors: [...] } object format
		const errors: ClientError[] | undefined = Array.isArray(parsed)
			? parsed
			: (parsed && typeof parsed === 'object' && 'errors' in parsed && Array.isArray((parsed as Record<string, unknown>).errors))
				? (parsed as { errors: ClientError[] }).errors
				: undefined;

		if (!Array.isArray(errors) || errors.length === 0) {
			return json({ error: 'Expected array of error objects' }, { status: 400 });
		}

		// Rate limit: max 50 errors per request
		const batch = errors.slice(0, 50);

		const adminClient = getAdminClient();

		if (adminClient) {
			const rows = batch.map((err) => ({
				type: (err.type || 'error').slice(0, 50),
				message: (err.message || '').slice(0, 1000),
				file: (err.file || '').slice(0, 500),
				line: err.line || 0,
				col: err.col || 0,
				stack: (err.stack || '').slice(0, 2000),
				url: (err.url || '').slice(0, 500),
				user_agent: (err.ua || '').slice(0, 300),
				session_id: (err.session || '').slice(0, 20),
				created_at: new Date().toISOString()
			}));

			const { error: insertError } = await adminClient
				.from('error_logs')
				.insert(rows);
			if (insertError) {
				console.warn(`[api/log] Supabase insert failed:`, insertError.message);
			}
		} else {
			for (const err of batch) {
				console.error(`[CLIENT ${err.type}] ${err.message} @ ${err.file}:${err.line}`);
			}
		}

		return new Response(null, { status: 204 });
	} catch (err) {
		console.error('Error log handler failed:', err);
		return new Response(null, { status: 500 });
	}
};
