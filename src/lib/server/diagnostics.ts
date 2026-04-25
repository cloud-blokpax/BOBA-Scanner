/**
 * Server-side diagnostic logging.
 *
 * Counterpart to src/lib/services/diagnostics.ts. Writes directly to
 * app_events via the service-role admin client — no /api/diag round-trip.
 *
 * Use from:
 *   - src/hooks.server.ts (handleError, request middleware)
 *   - src/routes/api/.../+server.ts (endpoint handlers)
 *   - src/lib/server/* (any server-only service)
 *
 * For browser code, use src/lib/services/diagnostics.ts instead.
 */

import { getAdminClient } from '$lib/server/supabase-admin';
import { env as privateEnv } from '$env/dynamic/private';
import { PIPELINE_VERSION } from '$lib/services/pipeline-version';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ServerLogEventInput {
	level: LogLevel;
	event: string;
	context?: Record<string, unknown>;
	error?: unknown;
	errorCode?: string;
	userId?: string | null;
	scanId?: string | null;
	gameId?: string | null;
	requestId?: string | null;
	durationMs?: number;
	source?: 'server' | 'edge' | 'cron';   // defaults to 'server'
}

const SHORT_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function generateShortCode(length = 6): string {
	// Use webcrypto so this works across both Node and Edge runtimes.
	const buf = new Uint32Array(length);
	crypto.getRandomValues(buf);
	let out = '';
	for (let i = 0; i < length; i++) {
		out += SHORT_CODE_ALPHABET[buf[i] % SHORT_CODE_ALPHABET.length];
	}
	return out;
}

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
 * Server-side log. Returns the short code if successful, null on failure.
 * Always non-throwing.
 */
export async function logEvent(input: ServerLogEventInput): Promise<{ shortCode: string } | null> {
	try {
		const admin = getAdminClient();
		if (!admin) return null;

		const errorBits = extractError(input.error);
		const ctx = redactContext(input.context ?? {});
		const shortCode = generateShortCode();

		const { data, error } = await admin
			.from('app_events')
			.insert({
				short_code: shortCode,
				level: input.level,
				source: input.source ?? 'server',
				event_name: input.event,
				user_id: input.userId ?? null,
				scan_id: input.scanId ?? null,
				game_id: input.gameId ?? null,
				request_id: input.requestId ?? null,
				context: ctx,
				error_message: errorBits.message,
				error_stack: errorBits.stack,
				error_code: input.errorCode ?? null,
				duration_ms: input.durationMs ?? null,
				pipeline_version: PIPELINE_VERSION,
				release_git_sha:
					privateEnv.VERCEL_GIT_COMMIT_SHA ??
					privateEnv.RELEASE_GIT_SHA ??
					null
			})
			.select('short_code')
			.single();

		if (error || !data) return null;
		return { shortCode: data.short_code };
	} catch {
		return null;   // never throw from a logger
	}
}

export function logFailure(
	eventName: string,
	err: unknown,
	context?: Record<string, unknown>,
	ids?: { userId?: string | null; scanId?: string | null; requestId?: string | null }
): void {
	void logEvent({
		level: 'error',
		event: eventName,
		error: err,
		context,
		...ids
	});
}

export async function wrap<T>(
	eventName: string,
	fn: () => Promise<T>,
	context?: Record<string, unknown>,
	ids?: { userId?: string | null; scanId?: string | null; requestId?: string | null }
): Promise<T> {
	const start = performance.now();
	try {
		const result = await fn();
		void logEvent({
			level: 'debug',
			event: `${eventName}.success`,
			context,
			durationMs: Math.round(performance.now() - start),
			...ids
		});
		return result;
	} catch (err) {
		void logEvent({
			level: 'error',
			event: `${eventName}.failed`,
			context,
			error: err,
			durationMs: Math.round(performance.now() - start),
			...ids
		});
		throw err;
	}
}
