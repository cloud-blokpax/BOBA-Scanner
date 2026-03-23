/**
 * Discriminated union for explicit success/failure handling.
 *
 * Use instead of throwing exceptions for expected failures (network offline,
 * rate limited, not authenticated, card not found). Reserve thrown exceptions
 * for programming errors (null reference, type mismatch).
 */
export type Result<T, E = string> =
	| { ok: true; data: T }
	| { ok: false; error: E };

/** Create a success result */
export function ok<T>(data: T): Result<T, never> {
	return { ok: true, data };
}

/** Create a failure result */
export function err<E = string>(error: E): Result<never, E> {
	return { ok: false, error };
}

/**
 * Wrap a promise that might throw into a Result.
 */
export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, string>> {
	try {
		return ok(await fn());
	} catch (e) {
		return err(e instanceof Error ? e.message : String(e));
	}
}

/**
 * Standard API error codes used across all API routes.
 */
export const API_CODES = {
	RATE_LIMITED: 'RATE_LIMITED',
	NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
	NOT_AUTHORIZED: 'NOT_AUTHORIZED',
	INVALID_INPUT: 'INVALID_INPUT',
	NOT_FOUND: 'NOT_FOUND',
	SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
	INTERNAL_ERROR: 'INTERNAL_ERROR',
	EBAY_UNAVAILABLE: 'EBAY_UNAVAILABLE',
	SCAN_FAILED: 'SCAN_FAILED',
	FILE_TOO_LARGE: 'FILE_TOO_LARGE',
	INVALID_FILE_TYPE: 'INVALID_FILE_TYPE'
} as const;

/** Standard API error response shape */
export interface ApiError {
	error: true;
	code: string;
	message: string;
}

/** Create a standard API error JSON response */
export function apiError(status: number, code: string, message: string): Response {
	return new Response(
		JSON.stringify({ error: true, code, message } satisfies ApiError),
		{
			status,
			headers: { 'Content-Type': 'application/json' }
		}
	);
}
