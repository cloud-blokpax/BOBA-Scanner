/**
 * GET /api/admin/harvest-log — Per-card harvest results from nightly eBay price runs
 *
 * Query params:
 *   run_id  — YYYY-MM-DD date string (defaults to most recent run)
 *   filter  — all | changed | new | zero | errors (default: all)
 *   sort    — newest | oldest (default: newest)
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
	'success', 'zero_results', 'threshold_rejected', 'error_message',
	'search_query', 'duration_ms', 'processed_at'
].join(', ');

type Filter = 'all' | 'changed' | 'new' | 'zero' | 'rejected' | 'errors';

const VALID_FILTERS = new Set<Filter>(['all', 'changed', 'new', 'zero', 'rejected', 'errors']);

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const filter = (url.searchParams.get('filter') || 'all') as Filter;
	if (!VALID_FILTERS.has(filter)) throw error(400, 'Invalid filter');

	const sort = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';

	const limit = Math.min(
		Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
		MAX_LIMIT
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

	// ── Resolve run_id ──────────────────────────────────────
	let runId = url.searchParams.get('run_id') || '';

	// Fetch available runs (distinct run_ids, most recent first) — paginated in 1k chunks
	const CHUNK = 1000;
	const allRunRows: Array<{ run_id: string }> = [];
	{
		let runOffset = 0;
		let done = false;
		while (!done) {
			const { data } = await admin
				.from('price_harvest_log')
				.select('run_id')
				.order('processed_at', { ascending: false })
				.range(runOffset, runOffset + CHUNK - 1);
			if (!data || data.length === 0) { done = true; }
			else {
				allRunRows.push(...(data as Array<{ run_id: string }>));
				runOffset += CHUNK;
				if (data.length < CHUNK) done = true;
			}
		}
	}

	const availableRuns = [...new Set<string>(allRunRows.map(r => r.run_id))];

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
	// Run summary aggregation in SQL (avoids 1,000-row client limit)
	// and detail pagination in parallel
	const [summaryRes, detailRes] = await Promise.all([
		admin.rpc('get_harvest_summary', { p_run_id: runId }),
		buildDetailQuery(admin, runId, filter, sort, offset, limit)
	]);

	interface HarvestSummary {
		total?: number;
		changed?: number;
		new_prices?: number;
		zero_results?: number;
		errors?: number;
		avg_duration?: number;
		max_depth?: number;
		started_at?: string | null;
		ended_at?: string | null;
	}

	const rawSummary = summaryRes.data as unknown as HarvestSummary | HarvestSummary[] | null;
	const s: HarvestSummary = (Array.isArray(rawSummary) ? rawSummary[0] : rawSummary) ?? {};

	return json({
		runId,
		availableRuns,
		summary: {
			total: Number(s.total ?? 0),
			changed: Number(s.changed ?? 0),
			newPrices: Number(s.new_prices ?? 0),
			zeroResults: Number(s.zero_results ?? 0),
			errors: Number(s.errors ?? 0),
			avgDurationMs: Number(s.avg_duration ?? 0),
			maxChainDepth: Number(s.max_depth ?? 0),
			startedAt: s.started_at ?? null,
			endedAt: s.ended_at ?? null
		},
		rows: detailRes.data || [],
		pagination: {
			offset,
			limit,
			total: detailRes.count ?? (detailRes.data || []).length
		}
	});
};

function buildDetailQuery(admin: NonNullable<ReturnType<typeof getAdminClient>>, runId: string, filter: Filter, sort: 'newest' | 'oldest', offset: number, limit: number) {
	let query = admin
		.from('price_harvest_log')
		.select(DETAIL_COLUMNS, { count: 'exact' })
		.eq('run_id', runId)
		.order('processed_at', { ascending: sort === 'oldest' })
		.range(offset, offset + limit - 1);

	switch (filter) {
		case 'changed': query = query.eq('price_changed', true); break;
		case 'new': query = query.eq('is_new_price', true); break;
		case 'zero': query = query.eq('zero_results', true); break;
		case 'rejected': query = query.eq('threshold_rejected', true); break;
		case 'errors': query = query.eq('success', false); break;
	}

	return query;
}
