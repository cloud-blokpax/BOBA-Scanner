/**
 * GET /api/cron/wtp-scrape — Weekly Wonders Trading Post scrape.
 *
 * Triggers the same logic as the manual admin button (POST /api/admin/wtp/scrape)
 * but auth-gated by CRON_SECRET instead of admin session.
 *
 * Idempotent on retry: scraping_test uses upsert(card_id), and as of
 * this branch scraping_test_history uses upsert(card_id, pull_date).
 *
 * Triggered by QStash via /api/cron/qstash-wtp-scrape weekly on Sunday
 * at 05:00 UTC.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getAdminClient } from '$lib/server/supabase-admin';
import { runWtpScrape } from '$lib/server/wtp/scrape-runner';
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
		return json({ skipped: true, reason: 'admin client unavailable' });
	}

	const startedAt = new Date().toISOString();
	try {
		const summary = await runWtpScrape(admin);
		void logEvent({
			level: 'info',
			event: 'wtp.scrape_completed',
			context: {
				startedAt,
				upserted_rows: summary.upserted_rows,
				history_rows: summary.history_rows,
				matched_card_count: summary.matched_card_count,
				unmatched_listing_count: summary.unmatched_listing_count,
				unmapped_treatments_count: summary.unmapped_treatments.length,
				unmapped_sets_count: summary.unmapped_sets.length
			}
		});
		return json({ ok: true, startedAt, finishedAt: new Date().toISOString(), summary });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		void logEvent({
			level: 'error',
			event: 'wtp.scrape_failed',
			error: msg,
			context: { startedAt }
		});
		return json(
			{ ok: false, startedAt, finishedAt: new Date().toISOString(), error: msg },
			{ status: 500 }
		);
	}
};
