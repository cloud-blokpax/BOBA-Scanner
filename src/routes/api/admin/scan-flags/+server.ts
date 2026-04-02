/**
 * /api/admin/scan-flags — Misidentification review queue
 *
 * GET: List pending scan flags
 * PUT: Resolve a scan flag (confirm_user, confirm_ai, edit)
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { parseJsonBody } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const status = url.searchParams.get('status') || 'pending';
	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

	const { data, error: dbError } = await admin
		.from('scan_flags')
		.select('*')
		.eq('status', status)
		.order('created_at', { ascending: false })
		.limit(limit);

	if (dbError) {
		console.error('[admin/scan-flags] GET DB error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	return json({ flags: data || [] });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const { user } = await locals.safeGetSession();
	const rateLimit = await checkMutationRateLimit(user!.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const body = await parseJsonBody<Record<string, unknown>>(request);
	const { id, status: newStatus, notes, corrected_card } = body as { id?: string; status?: string; notes?: string; corrected_card?: string };

	if (!id) throw error(400, 'Flag ID is required');
	if (!newStatus || !['confirmed_user', 'confirmed_ai', 'resolved'].includes(newStatus)) {
		throw error(400, 'Invalid status');
	}

	const updates: Record<string, unknown> = {
		status: newStatus,
		resolved_by: user!.id,
		resolved_at: new Date().toISOString()
	};
	if (notes) updates.notes = notes;
	if (corrected_card) updates.card_suggested = corrected_card;

	const { error: dbError } = await admin
		.from('scan_flags')
		.update(updates)
		.eq('id', id);

	if (dbError) {
		console.error('[admin/scan-flags] PUT DB error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	// Log admin action
	const { error: logError } = await admin.from('admin_activity_log').insert({
		admin_id: user!.id,
		action: 'resolve_scan_flag',
		entity_type: 'scan_flag',
		entity_id: id,
		details: { new_status: newStatus, notes }
	});
	if (logError) {
		console.error('[admin/scan-flags] Activity log insert FAILED:', logError.message);
	}

	return json({ success: true });
};
