/**
 * Server-side input validation helpers.
 *
 * Centralizes validation logic so every API endpoint inherits the
 * same rules and error formats. Throws SvelteKit errors on failure.
 */

import { error } from '@sveltejs/kit';

// ── Primitive validators ────────────────────────────────────

export function requireString(value: unknown, field: string, maxLength = 1000): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw error(400, `${field} is required and must be a non-empty string`);
	}
	if (value.length > maxLength) {
		throw error(400, `${field} exceeds maximum length of ${maxLength}`);
	}
	return value.trim();
}

export function requireNumber(value: unknown, field: string, min?: number, max?: number): number {
	const num = typeof value === 'number' ? value : parseFloat(String(value));
	if (isNaN(num)) {
		throw error(400, `${field} must be a valid number`);
	}
	if (min !== undefined && num < min) {
		throw error(400, `${field} must be at least ${min}`);
	}
	if (max !== undefined && num > max) {
		throw error(400, `${field} must be at most ${max}`);
	}
	return num;
}

export function optionalString(value: unknown, maxLength = 1000): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') return null;
	if (value.trim().length === 0) return null;
	return value.trim().slice(0, maxLength);
}

// ── Domain validators ───────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD_ID_REGEX = /^[\w-]{1,64}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireCardId(value: unknown, field = 'card_id'): string {
	const str = requireString(value, field, 64);
	if (!CARD_ID_REGEX.test(str)) {
		throw error(400, `${field} has an invalid format`);
	}
	return str;
}

export function requireUuid(value: unknown, field: string): string {
	const str = requireString(value, field, 36);
	if (!UUID_REGEX.test(str)) {
		throw error(400, `${field} must be a valid UUID`);
	}
	return str;
}

export function requireEmail(value: unknown, field = 'email'): string {
	const str = requireString(value, field, 254);
	if (!EMAIL_REGEX.test(str)) {
		throw error(400, `${field} must be a valid email address`);
	}
	return str.toLowerCase();
}

export function requireCardIds(value: unknown, field: string, maxCount = 100): string[] {
	if (!Array.isArray(value)) {
		throw error(400, `${field} must be an array`);
	}
	if (value.length === 0) {
		throw error(400, `${field} must not be empty`);
	}
	if (value.length > maxCount) {
		throw error(400, `${field} exceeds maximum of ${maxCount} items`);
	}
	return value.map((v, i) => requireCardId(v, `${field}[${i}]`));
}

// ── Auth helpers ────────────────────────────────────────────

export async function requireAuth(locals: App.Locals): Promise<{ id: string; email?: string }> {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');
	return user;
}

export function requireSupabase(locals: App.Locals) {
	if (!locals.supabase) throw error(503, 'Database not available');
	return locals.supabase;
}

// ── JSON body parser with validation ────────────────────────

export async function parseJsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
	try {
		const body = await request.json();
		if (typeof body !== 'object' || body === null || Array.isArray(body)) {
			throw error(400, 'Request body must be a JSON object');
		}
		return body as T;
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		throw error(400, 'Invalid JSON in request body');
	}
}
