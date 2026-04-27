/**
 * GET /api/cron/mark-stale-listings — Daily maintenance for the eBay listing
 * observation tables.
 *
 * Runs two SQL maintenance functions back-to-back:
 *   - `mark_stale_ebay_listings()` — flips `ebay_card_images.is_active` to
 *     false for rows that haven't been re-observed for 7 days. Approximates
 *     eBay's relist cycle — anything older has either sold, ended, or been
 *     pulled.
 *   - `prune_old_observations()` — deletes `ebay_listing_observations` rows
 *     older than 30 days. Bounds steady-state storage to ~1.2 GB.
 *
 * Triggered by QStash (via /api/cron/qstash-mark-stale-listings, server-to-
 * server, bypassing Vercel Deployment Protection). Same security model as
 * qstash-harvest / qstash-vercel-mirror.
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

	// Mark stale image rows inactive — fire even if pruning fails so the two
	// concerns stay independent.
	let markStaleError: string | null = null;
	try {
		const { error: rpcError } = await (
			admin.rpc as unknown as (
				name: 'mark_stale_ebay_listings'
			) => Promise<{ error: { message: string } | null }>
		)('mark_stale_ebay_listings');
		if (rpcError) {
			markStaleError = rpcError.message;
			void logEvent({
				level: 'error',
				event: 'harvest.observations.mark_stale_failed',
				error: rpcError.message
			});
		}
	} catch (err) {
		markStaleError = err instanceof Error ? err.message : 'unknown';
		void logEvent({
			level: 'error',
			event: 'harvest.observations.mark_stale_threw',
			error: err
		});
	}

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
				event: 'harvest.observations.prune_failed',
				error: rpcError.message
			});
		}
	} catch (err) {
		pruneError = err instanceof Error ? err.message : 'unknown';
		void logEvent({
			level: 'error',
			event: 'harvest.observations.prune_threw',
			error: err
		});
	}

	return json({
		ok: !markStaleError && !pruneError,
		startedAt,
		finishedAt: new Date().toISOString(),
		markStaleError,
		pruneError
	});
};
