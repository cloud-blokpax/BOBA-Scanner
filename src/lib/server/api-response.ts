/**
 * Standardized API response helpers.
 *
 * Ensures all API endpoints return errors in the same format:
 * { error: string, code?: string, details?: unknown }
 *
 * Adopt in new endpoints immediately; migrate existing ones incrementally.
 */

import { json } from '@sveltejs/kit';

export interface ApiError {
	error: string;
	code?: string;
	details?: unknown;
}

export function apiError(
	message: string,
	status: number,
	opts?: { code?: string; headers?: Record<string, string>; details?: unknown }
): Response {
	const body: ApiError = { error: message };
	if (opts?.code) body.code = opts.code;
	if (opts?.details) body.details = opts.details;
	return json(body, { status, headers: opts?.headers });
}

export function rateLimited(result: { limit: number; remaining: number; reset: number }): Response {
	return apiError('Too many requests. Please wait before trying again.', 429, {
		code: 'RATE_LIMITED',
		headers: {
			'X-RateLimit-Limit': String(result.limit),
			'X-RateLimit-Remaining': String(result.remaining),
			'X-RateLimit-Reset': String(result.reset)
		},
		details: {
			limit: result.limit,
			remaining: result.remaining,
			reset: result.reset
		}
	});
}

export function serviceUnavailable(service: string): Response {
	return apiError(`${service} is not available`, 503, { code: 'SERVICE_UNAVAILABLE' });
}
