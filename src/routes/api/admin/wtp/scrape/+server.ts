/**
 * POST /api/admin/wtp/scrape
 *
 * Manually-triggered Wonders Trading Post scrape pass. Fetches all WTP
 * listings, matches them to our Wonders catalog, upserts pricing rows
 * into scraping_test (game_id='wonders'), and appends per-card audit
 * rows to scraping_test_history.
 *
 * Admin-only. No cron, no rate limit beyond the admin guard.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { runWtpScrape } from '$lib/server/wtp/scrape-runner';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	try {
		const summary = await runWtpScrape(admin);
		return json({ ok: true, summary });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[admin/wtp/scrape] failed:', msg);
		return json({ ok: false, error: msg }, { status: 500 });
	}
};
