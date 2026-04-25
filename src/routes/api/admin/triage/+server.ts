/**
 * GET /api/admin/triage
 *
 * Returns the triage queue for the admin UI:
 *   - active fingerprints (status IN new/regression/investigating/fix_pending)
 *   - recent triage actions (last 20 history rows)
 *   - archive (paginated, fixed/understood/ignore/duplicate)
 *
 * Query params:
 *   ?view=active  (default) — returns active queue + recent activity
 *   ?view=archive — returns archived fingerprints, paginated
 *   ?status=new   — filter by single status
 *   ?limit=50     — pagination (default 50, max 200)
 *   ?offset=0
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

type FingerprintStatus =
	| 'new'
	| 'investigating'
	| 'fix_pending'
	| 'fixed'
	| 'understood'
	| 'ignore'
	| 'duplicate'
	| 'regression';

const ACTIVE_STATUSES: FingerprintStatus[] = ['new', 'regression', 'investigating', 'fix_pending'];
const ARCHIVE_STATUSES: FingerprintStatus[] = ['fixed', 'understood', 'ignore', 'duplicate'];

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'database_unavailable');

	const view = url.searchParams.get('view') ?? 'active';
	const status = url.searchParams.get('status');
	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
	const offset = Number(url.searchParams.get('offset')) || 0;

	const statusFilter: FingerprintStatus[] = status
		? [status as FingerprintStatus]
		: view === 'archive'
			? ARCHIVE_STATUSES
			: ACTIVE_STATUSES;

	const { data: fingerprints, error: fpError } = await admin
		.from('event_fingerprints')
		.select('*')
		.in('status', statusFilter)
		.order('last_seen', { ascending: false })
		.range(offset, offset + limit - 1);

	if (fpError) {
		console.error('[admin/triage] fingerprints query failed:', fpError);
		throw error(500, 'database_error');
	}

	let recentActivity: unknown[] = [];
	if (view === 'active') {
		const { data: history } = await admin
			.from('event_triage_history')
			.select('*')
			.order('created_at', { ascending: false })
			.limit(20);
		recentActivity = history ?? [];
	}

	return json({
		fingerprints: fingerprints ?? [],
		recent_activity: recentActivity,
		view,
		limit,
		offset
	});
};
