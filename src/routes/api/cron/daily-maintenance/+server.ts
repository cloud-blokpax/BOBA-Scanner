/**
 * GET /api/cron/daily-maintenance — Daily watermark-gated pruning.
 *
 * Phase 2 invariant: never delete a row that isn't archived to R2.
 *
 * Order of operations:
 *   1. Read is_archive_fresh() — must be TRUE (all watermarks updated
 *      within last 26 hours). If FALSE, skip pruning entirely and log
 *      a warning. Archive cron failing → pruning becomes a no-op.
 *   2. Run three prune RPCs:
 *      - prune_archived_observations() (7-day safety buffer)
 *      - prune_archived_harvest_log() (7-day safety buffer)
 *      - prune_archived_external_pricing_history() (30-day safety buffer)
 *   3. Each RPC reads its watermark, computes safe_cutoff =
 *      last_archived_date - buffer_days, and deletes older rows.
 *
 * Disk space: Postgres doesn't return disk to OS automatically after
 * DELETE. Run VACUUM FULL manually if compute disk usage matters.
 *
 * Triggered by QStash via /api/cron/qstash-daily-maintenance, daily 04:00 UTC.
 * Note: archive cron runs at 04:30 UTC. The 26-hour freshness window in
 * is_archive_fresh() means daily-maintenance can run at 04:00 (BEFORE
 * archive) and still trust the watermark from yesterday's 04:30 fire.
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

	// ── 1. Refuse to prune if archive watermarks are stale ──
	// Phase 2 invariant: never delete a row that isn't archived to R2.
	// is_archive_fresh() returns TRUE only if every archive_watermark has
	// last_run_at within the last 26 hours. If archive cron is broken,
	// pruning becomes a no-op — by design.
	let archiveFresh = false;
	try {
		const { data, error: freshErr } = await (
			admin.rpc as unknown as (
				name: 'is_archive_fresh'
			) => Promise<{ data: boolean | null; error: { message: string } | null }>
		)('is_archive_fresh');
		if (freshErr) {
			void logEvent({
				level: 'error',
				event: 'maintenance.archive_freshness_check_failed',
				error: freshErr.message
			});
		}
		archiveFresh = data === true;
	} catch (err) {
		void logEvent({
			level: 'error',
			event: 'maintenance.archive_freshness_check_threw',
			error: err
		});
	}

	if (!archiveFresh) {
		void logEvent({
			level: 'warn',
			event: 'maintenance.skip_prune_archive_stale',
			context: { reason: 'archive_watermark.last_run_at > 26h old; skipping all prunes' }
		});
		return json({
			ok: true,
			startedAt,
			finishedAt: new Date().toISOString(),
			pruned: false,
			reason: 'archive_stale'
		});
	}

	// ── 2. Run all three watermark-gated prunes (best-effort) ──
	type PruneRow = {
		deleted_rows: number;
		safe_cutoff: string | null;
		watermark_date: string | null;
	};
	const pruneResults: Array<{
		table: string;
		rows: number;
		safe_cutoff: string | null;
		error?: string;
	}> = [];

	const PRUNE_RPCS: Array<{ table: string; rpc: string }> = [
		{ table: 'ebay_listing_observations', rpc: 'prune_archived_observations' },
		{ table: 'price_harvest_log', rpc: 'prune_archived_harvest_log' },
		{ table: 'external_pricing_history', rpc: 'prune_archived_external_pricing_history' }
	];

	for (const { table, rpc } of PRUNE_RPCS) {
		try {
			const { data, error: rpcError } = await (
				admin.rpc as unknown as (
					name: string
				) => Promise<{ data: PruneRow[] | null; error: { message: string } | null }>
			)(rpc);
			if (rpcError) {
				pruneResults.push({ table, rows: 0, safe_cutoff: null, error: rpcError.message });
				void logEvent({
					level: 'error',
					event: 'maintenance.prune_failed',
					error: rpcError.message,
					context: { table }
				});
			} else {
				const row = data?.[0];
				pruneResults.push({
					table,
					rows: row?.deleted_rows ?? 0,
					safe_cutoff: row?.safe_cutoff ?? null
				});
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'unknown';
			pruneResults.push({ table, rows: 0, safe_cutoff: null, error: msg });
			void logEvent({
				level: 'error',
				event: 'maintenance.prune_threw',
				error: err,
				context: { table }
			});
		}
	}

	const totalDeleted = pruneResults.reduce((s, r) => s + r.rows, 0);
	void logEvent({
		level: 'info',
		event: 'maintenance.prune_completed',
		context: { totalDeleted, results: pruneResults }
	});

	// ── 3. Refresh canonical attribution views ──
	// canonical_listing_attributions deduplicates eBay listings across cards
	// that share names (Bug D). canonical_price_cache derives from it. The
	// SQL function refreshes both in correct order. CONCURRENTLY so reads
	// aren't blocked. See migration 20260512195404 / 20260512201215.
	let canonicalRefresh: { ok: boolean; durationMs: number; error?: string } = {
		ok: false,
		durationMs: 0
	};
	const refreshStart = Date.now();
	try {
		const { error: refreshErr } = await (
			admin.rpc as unknown as (
				name: 'refresh_canonical_listing_attributions'
			) => Promise<{ data: unknown; error: { message: string } | null }>
		)('refresh_canonical_listing_attributions');
		canonicalRefresh = {
			ok: !refreshErr,
			durationMs: Date.now() - refreshStart,
			...(refreshErr ? { error: refreshErr.message } : {})
		};
		if (refreshErr) {
			void logEvent({
				level: 'error',
				event: 'maintenance.canonical_refresh_failed',
				error: refreshErr.message
			});
		}
	} catch (err) {
		canonicalRefresh = {
			ok: false,
			durationMs: Date.now() - refreshStart,
			error: err instanceof Error ? err.message : 'unknown'
		};
		void logEvent({
			level: 'error',
			event: 'maintenance.canonical_refresh_threw',
			error: err
		});
	}

	return json({
		ok: pruneResults.every((r) => !r.error) && canonicalRefresh.ok,
		startedAt,
		finishedAt: new Date().toISOString(),
		pruned: true,
		totalDeleted,
		results: pruneResults,
		canonicalRefresh
	});
};
