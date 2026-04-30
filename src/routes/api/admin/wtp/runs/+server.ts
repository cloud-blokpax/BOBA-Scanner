/**
 * GET /api/admin/wtp/runs
 *
 * Returns recent WTP scrape activity by aggregating scraping_test_history
 * rows (game_id='wonders') by pull_date. One row per day with rolled-up
 * card count and sales totals.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

interface HistoryRow {
	pull_date: string;
	st_total_sales: number | null;
	st_sales_30d: number | null;
}

export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	// PostgREST caps un-paginated reads at db-max-rows=1000, so the previous
	// .limit(2000) was silently returning only 1000 of ~17K rows. Paginate
	// explicitly. The aggregate is per-pull-date and we slice to 30 dates at
	// the end, so we only need enough rows to cover ~30 distinct pull_dates;
	// in practice the full table fits in a few pages.
	const PAGE_SIZE = 1000;
	const MAX_PAGES = 20; // Hard cap so a runaway table can't pull forever.
	const rows: HistoryRow[] = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const offset = page * PAGE_SIZE;
		const { data, error: dbErr } = await admin
			.from('scraping_test_history')
			.select('pull_date, st_total_sales, st_sales_30d')
			.eq('game_id', 'wonders')
			.order('pull_date', { ascending: false })
			.range(offset, offset + PAGE_SIZE - 1);
		if (dbErr) throw error(500, dbErr.message);
		if (!data || data.length === 0) break;
		rows.push(...(data as HistoryRow[]));
		if (data.length < PAGE_SIZE) break;
	}

	const byDate = new Map<
		string,
		{ date: string; cards_with_data: number; total_sold_lifetime: number; sales_30d: number }
	>();
	for (const row of rows) {
		const k = row.pull_date;
		const acc =
			byDate.get(k) ??
			{ date: k, cards_with_data: 0, total_sold_lifetime: 0, sales_30d: 0 };
		acc.cards_with_data += 1;
		acc.total_sold_lifetime += row.st_total_sales ?? 0;
		acc.sales_30d += row.st_sales_30d ?? 0;
		byDate.set(k, acc);
	}

	return json({ runs: [...byDate.values()].slice(0, 30) });
};
