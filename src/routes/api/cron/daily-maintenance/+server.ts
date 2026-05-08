/**
 * GET /api/cron/daily-maintenance — Daily maintenance for the eBay harvest tables.
 *
 * Runs SQL maintenance functions back-to-back. Each is independent — one
 * failing does not stop the others.
 *
 *   - `prune_old_observations()` — deletes `ebay_listing_observations` rows
 *     older than 30 days. Bounds steady-state storage. Phase 2 will tighten
 *     this window to 7 days once R2 archives are stable.
 *
 *   - `refresh_filter_health()` — refreshes mv_filter_health for ad-hoc
 *     diagnosis via /api/admin/filter-health. CONCURRENTLY so it doesn't
 *     block reads.
 *
 * (Previously also called mark_stale_ebay_listings(); that function flipped
 * a boolean nobody read. Removed in migration 058.)
 *
 * Triggered by QStash (via /api/cron/qstash-daily-maintenance, server-to-
 * server, bypassing Vercel Deployment Protection). Same security model as
 * qstash-harvest.
 *
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

	// ── 2. Refresh filter-health MV (best-effort) ─────────────
	let filterHealthRefreshError: string | null = null;
	let filterHealthRows: number | null = null;
	try {
		const { data, error: rpcError } = await (
			admin.rpc as unknown as (
				name: 'refresh_filter_health'
			) => Promise<{
				data: Array<{ refreshed_rows: number; ran_at: string }> | null;
				error: { message: string } | null;
			}>
		)('refresh_filter_health');
		if (rpcError) {
			filterHealthRefreshError = rpcError.message;
			void logEvent({
				level: 'error',
				event: 'maintenance.filter_health_refresh_failed',
				error: rpcError.message
			});
		} else if (data && data.length > 0) {
			filterHealthRows = data[0].refreshed_rows;
		}
	} catch (err) {
		filterHealthRefreshError = err instanceof Error ? err.message : 'unknown';
		void logEvent({
			level: 'error',
			event: 'maintenance.filter_health_refresh_threw',
			error: err
		});
	}

	return json({
		ok: !pruneError && !filterHealthRefreshError,
		startedAt,
		finishedAt: new Date().toISOString(),
		pruneError,
		filterHealthRefreshError,
		filterHealthRows
	});
};
