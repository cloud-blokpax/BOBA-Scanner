/**
 * GET /api/cron/daily-maintenance — Daily maintenance for the eBay harvest tables.
 *
 * Currently runs one SQL maintenance function:
 *   - `prune_old_observations()` — deletes `ebay_listing_observations` rows
 *     older than 30 days. Phase 2 will tighten this to 7 days once the
 *     R2 archive cron has run cleanly for a week.
 *
 * Triggered by QStash via /api/cron/qstash-daily-maintenance, daily 04:00 UTC.
 * Auth: CRON_SECRET header.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getAdminClient } from '$lib/server/supabase-admin';
import { logEvent } from '$lib/server/diagnostics';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

export const GET: RequestHandler = async ({ request }) => {
	const auth = request.headers.get('authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
		throw error(401, 'unauthorized');
	}

	const admin = getAdminClient();
	if (!admin) {
		return json({ skipped: true, reason: 'Admin client unavailable' });
	}

	const startedAt = new Date().toISOString();

	// ── 1. Prune old observations (best-effort) ───────────────
	let pruneError: string | null = null;
	try {
		const { error: rpcError } = await (
			admin.rpc as unknown as (
				name: 'prune_old_observations'
			) => Promise<{ error: { message: string } | null }>
		)('prune_old_observations');
		if (rpcError) {
			pruneError = rpcError.message;
			void logEvent({
				level: 'error',
				event: 'maintenance.prune_observations_failed',
				error: rpcError.message
			});
		}
	} catch (err) {
		pruneError = err instanceof Error ? err.message : 'unknown';
		void logEvent({
			level: 'error',
			event: 'maintenance.prune_observations_threw',
			error: err
		});
	}

	return json({
		ok: !pruneError,
		startedAt,
		finishedAt: new Date().toISOString(),
		pruneError
	});
};
