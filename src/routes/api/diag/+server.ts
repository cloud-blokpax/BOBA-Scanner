/**
 * POST /api/diag — Diagnostic event ingestion endpoint
 *
 * Receives one event payload at a time from src/lib/services/diagnostics.ts.
 * Enriches with user_id (from session), request_id (generated), release_git_sha
 * (from build env), then INSERTs to app_events via the admin client.
 *
 * Rate limited per IP. Validates payload shape strictly.
 */

import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/supabase-admin';
import { env as privateEnv } from '$env/dynamic/private';
import { PIPELINE_VERSION } from '$lib/services/pipeline-version';
import type { RequestHandler } from './$types';

// In-memory rate limit (200 events/minute per IP). Server-only state, fine
// for a SvelteKit/Vercel function.
const rateMap = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 200;

function checkRateLimit(ip: string): boolean {
	const now = Date.now();
	const entry = rateMap.get(ip) || { count: 0, windowStart: now };
	if (now - entry.windowStart > RATE_WINDOW_MS) {
		entry.count = 0;
		entry.windowStart = now;
	}
	if (entry.count >= RATE_MAX) {
		rateMap.set(ip, entry);
		return false;
	}
	entry.count++;
	rateMap.set(ip, entry);

	// Periodic cleanup
	if (rateMap.size > 1000) {
		for (const [k, v] of rateMap) {
			if (now - v.windowStart > RATE_WINDOW_MS * 2) rateMap.delete(k);
		}
	}
	return true;
}

const SHORT_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function generateShortCode(length = 6): string {
	const buf = new Uint32Array(length);
	crypto.getRandomValues(buf);
	let out = '';
	for (let i = 0; i < length; i++) {
		out += SHORT_CODE_ALPHABET[buf[i] % SHORT_CODE_ALPHABET.length];
	}
	return out;
}

const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);

interface IncomingPayload {
	level?: unknown;
	event_name?: unknown;
	context?: unknown;
	error_message?: unknown;
	error_stack?: unknown;
	error_code?: unknown;
	scan_id?: unknown;
	game_id?: unknown;
	request_id?: unknown;
	duration_ms?: unknown;
	app_version?: unknown;
}

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	if (!checkRateLimit(getClientAddress())) {
		return json({ error: 'rate_limited' }, { status: 429 });
	}

	let payload: IncomingPayload;
	try {
		payload = await request.json();
	} catch {
		throw error(400, 'invalid_json');
	}

	// Strict shape validation. Anything missing → 400.
	if (
		!payload ||
		typeof payload !== 'object' ||
		typeof payload.level !== 'string' ||
		!VALID_LEVELS.has(payload.level) ||
		typeof payload.event_name !== 'string' ||
		payload.event_name.length === 0 ||
		payload.event_name.length > 200
	) {
		throw error(400, 'invalid_payload');
	}

	const admin = getAdminClient();
	if (!admin) throw error(503, 'database_unavailable');

	// Get user_id from session (may be null for anon users — that's fine)
	const { user } = await locals.safeGetSession();
	const userId = user?.id ?? null;

	const shortCode = generateShortCode();

	const { error: insertError } = await admin.from('app_events').insert({
		short_code: shortCode,
		level: payload.level as 'debug' | 'info' | 'warn' | 'error' | 'fatal',
		source: 'client',
		event_name: (payload.event_name as string).slice(0, 200),
		user_id: userId,
		scan_id: typeof payload.scan_id === 'string' ? payload.scan_id : null,
		game_id: typeof payload.game_id === 'string' ? payload.game_id.slice(0, 50) : null,
		request_id:
			typeof payload.request_id === 'string' ? payload.request_id.slice(0, 100) : null,
		context:
			typeof payload.context === 'object' && payload.context
				? (payload.context as Record<string, unknown>)
				: {},
		error_message:
			typeof payload.error_message === 'string' ? payload.error_message.slice(0, 1000) : null,
		error_stack:
			typeof payload.error_stack === 'string' ? payload.error_stack.slice(0, 4000) : null,
		error_code:
			typeof payload.error_code === 'string' ? payload.error_code.slice(0, 100) : null,
		duration_ms:
			typeof payload.duration_ms === 'number' ? payload.duration_ms : null,
		pipeline_version: PIPELINE_VERSION,
		release_git_sha:
			privateEnv.VERCEL_GIT_COMMIT_SHA ?? privateEnv.RELEASE_GIT_SHA ?? null,
		app_version:
			typeof payload.app_version === 'string' ? payload.app_version.slice(0, 50) : null
	});

	if (insertError) {
		// Don't propagate — logger errors should never break callers.
		console.error('[api/diag] insert failed:', insertError.message);
		return json({ ok: false, error: 'insert_failed' }, { status: 500 });
	}

	return json({ ok: true, short_code: shortCode });
};
