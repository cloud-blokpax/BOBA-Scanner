/**
 * /api/admin/scan-flags — Misidentification review queue
 *
 * Phase 0.4a rewire: reads from scan_disputes (new schema) instead of
 * the dropped scan_flags table. Public route name preserved for frontend
 * compatibility; underlying data is now the unified dispute flow.
 *
 * GET: List pending disputes
 * PUT: Resolve a dispute (upheld / rejected / inconclusive)
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { parseJsonBody } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

// Map legacy status values (from any frontend still sending them)
// to the new dispute_resolution enum.
const STATUS_MAP: Record<string, 'pending' | 'upheld' | 'rejected' | 'inconclusive'> = {
	pending: 'pending',
	confirmed_user: 'upheld',      // User was right; AI got it wrong
	confirmed_ai: 'rejected',       // AI was right; user dispute invalid
	resolved: 'inconclusive',       // Closed without clear verdict
	upheld: 'upheld',
	rejected: 'rejected',
	inconclusive: 'inconclusive',
};

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const statusParam = url.searchParams.get('status') || 'pending';
	const resolution = STATUS_MAP[statusParam] ?? 'pending';
	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

	// scan_disputes isn't in database.ts yet (Phase 0.5 regeneration pending)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data, error: dbError } = await (admin as any)
		.from('scan_disputes')
		.select(`
			id,
			resolution_id,
			scan_id,
			disputing_user_id,
			proposed_card_id,
			proposed_variant,
			reason_text,
			revalidation_verdict,
			revalidated_at,
			resolution,
			resolved_at,
			resolved_by,
			created_at
		`)
		.eq('resolution', resolution)
		.order('created_at', { ascending: false })
		.limit(limit);

	if (dbError) {
		console.error('[admin/scan-flags] GET DB error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	// Shape the response to match the legacy `flags` key the frontend expects.
	return json({ flags: data || [] });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, {
			status: 429,
			headers: {
				'X-RateLimit-Limit': String(rateLimit.limit),
				'X-RateLimit-Remaining': String(rateLimit.remaining),
				'X-RateLimit-Reset': String(rateLimit.reset),
			},
		});
	}

	const body = await parseJsonBody<Record<string, unknown>>(request);
	const { id, status: newStatus, notes, corrected_card } = body as {
		id?: string;
		status?: string;
		notes?: string;
		corrected_card?: string;
	};

	if (!id) throw error(400, 'Dispute ID is required');
	const mappedResolution = STATUS_MAP[newStatus ?? ''];
	if (!mappedResolution || mappedResolution === 'pending') {
		throw error(400, 'Invalid resolution status');
	}

	const updates: Record<string, unknown> = {
		resolution: mappedResolution,
		resolved_by: 'admin',
		resolved_at: new Date().toISOString(),
	};
	if (notes) {
		// Notes go into extras since scan_disputes doesn't have a dedicated notes column.
		updates.extras = { admin_notes: notes };
	}
	if (corrected_card) {
		updates.proposed_card_id = corrected_card;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error: dbError } = await (admin as any)
		.from('scan_disputes')
		.update(updates)
		.eq('id', id);

	if (dbError) {
		console.error('[admin/scan-flags] PUT DB error:', dbError.message);
		throw error(500, 'Database operation failed');
	}

	// Log admin action — admin_activity_log table unchanged.
	const { error: logError } = await admin.from('admin_activity_log').insert({
		admin_id: user.id,
		action: 'resolve_scan_dispute',
		entity_type: 'scan_dispute',
		entity_id: id,
		details: { new_resolution: mappedResolution, notes },
	});

	if (logError) console.warn('[admin/scan-flags] activity log write failed:', logError.message);

	return json({ success: true });
};
