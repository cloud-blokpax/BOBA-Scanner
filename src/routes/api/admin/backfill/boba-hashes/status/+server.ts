/**
 * GET /api/admin/backfill/boba-hashes/status
 *
 * Returns the current state of the BoBA hash backfill (Redis-backed).
 * Admin-only. Safe to poll every 5s from the admin UI.
 */

import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getRedis } from '$lib/server/redis';
import type { RequestHandler } from './$types';

const MUTEX_KEY = 'backfill:boba-hashes:lock';

export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);
	const redis = getRedis();
	if (!redis) return json({ status: null, error: 'redis unavailable' });

	const status = await redis.get(MUTEX_KEY);
	return json({ status: status ?? null });
};
