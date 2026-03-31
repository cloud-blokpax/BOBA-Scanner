/**
 * GET /api/admin/harvest-log — Per-card harvest results from nightly eBay price runs
 *
 * Query params:
 *   run_id  — YYYY-MM-DD date string (defaults to most recent run)
 *   filter  — all | changed | new | zero | errors (default: all)
 *   limit   — page size, max 200, default 50
 *   offset  — pagination offset, default 0
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const DETAIL_COLUMNS = [
	'card_id', 'hero_name', 'card_name', 'card_number', 'priority',
	'price_mid', 'previous_mid', 'price_changed', 'price_delta', 'price_delta_pct',
	'is_new_price', 'confidence_score', 'listings_count',
	'success', 'zero_results', 'error_message', 'duration_ms', 'processed_at'
].join(', ');

type Filter = 'all' | 'changed' | 'new' | 'zero' | 'errors';

const VALID_FILTERS = new Set<Filter>(['all', 'changed', 'new', 'zero', 'errors']);

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const filter = (url.searchParams.get('filter') || 'all') as Filter;
	if (!VALID_FILTERS.has(filter)) throw error(400, 'Invalid filter');

	const limit = Math.min(
		Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
		MAX_LIMIT
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

	// ── Resolve run_id ──────────────────────────────────────
	let runId = url.searchParams.get('run_id') || '';

	// Fetch available runs (distinct run_ids, most recent first)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: runRows } = await (admin as any)
		.from('price_harvest_log')
		.select('run_id')
		.order('processed_at', { ascending: false })
		.limit(5000);

	const availableRuns = [...new Set<string>((runRows || []).map((r: { run_id: string }) => r.run_id))];

	if (!runId && availableRuns.length > 0) {
		runId = availableRuns[0];
	}

	if (!runId) {
		return json({
			runId: null,
			availableRuns: [],
			summary: null,
			rows: [],
			pagination: { offset: 0, limit, total: 0 }
		});
	}

	// ── Summary + detail rows in parallel ───────────────────
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const adminAny = admin as any;

	const [summaryRes, detailRes] = await Promise.all([
		// Summary: lightweight columns for the entire run
		adminAny
			.from('price_harvest_log')
			.select('success, price_changed, is_new_price, zero_results, duration_ms, chain_depth, processed_at')
			.eq('run_id', runId),

		// Detail: filtered + paginated rows
		buildDetailQuery(adminAny, runId, filter, offset, limit)
	]);

	// Compute summary stats in JS
	const summaryRows: Array<{
		success: boolean;
		price_changed: boolean;
		is_new_price: boolean;
		zero_results: boolean;
		duration_ms: number | null;
		chain_depth: number;
		processed_at: string;
	}> = summaryRes.data || [];

	let totalDuration = 0;
	let durationCount = 0;
	let maxChainDepth = 0;
	let startedAt: string | null = null;
	let endedAt: string | null = null;
	let changed = 0;
	let newPrices = 0;
	let zeroResults = 0;
	let errors = 0;

	for (const row of summaryRows) {
		if (row.price_changed) changed++;
		if (row.is_new_price) newPrices++;
		if (row.zero_results) zeroResults++;
		if (!row.success) errors++;
		if (row.duration_ms != null) {
			totalDuration += row.duration_ms;
			durationCount++;
		}
		if (row.chain_depth > maxChainDepth) maxChainDepth = row.chain_depth;
		if (!startedAt || row.processed_at < startedAt) startedAt = row.processed_at;
		if (!endedAt || row.processed_at > endedAt) endedAt = row.processed_at;
	}

	return json({
		runId,
		availableRuns,
		summary: {
			total: summaryRows.length,
			changed,
			newPrices,
			zeroResults,
			errors,
			avgDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
			maxChainDepth,
			startedAt,
			endedAt
		},
		rows: detailRes.data || [],
		pagination: {
			offset,
			limit,
			total: detailRes.count ?? (detailRes.data || []).length
		}
	});
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDetailQuery(admin: any, runId: string, filter: Filter, offset: number, limit: number) {
	let query = admin
		.from('price_harvest_log')
		.select(DETAIL_COLUMNS, { count: 'exact' })
		.eq('run_id', runId)
		.order('processed_at', { ascending: true })
		.range(offset, offset + limit - 1);

	switch (filter) {
		case 'changed': query = query.eq('price_changed', true); break;
		case 'new': query = query.eq('is_new_price', true); break;
		case 'zero': query = query.eq('zero_results', true); break;
		case 'errors': query = query.eq('success', false); break;
	}

	return query;
}
