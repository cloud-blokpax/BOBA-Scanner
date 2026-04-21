/**
 * /api/dev/alignment-telemetry — Phase 1.5.a spike
 *
 * Admin-gated bulk insert endpoint for the alignment-signal validation
 * spike. Accepts up to 100 rows per POST and writes them to
 * alignment_signal_telemetry via the service-role client.
 *
 * Delete after Phase 1.5.a data is captured and Session 1.5.b ships.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { parseJsonBody } from '$lib/server/validate';
import type { RequestHandler } from './$types';

const MAX_ROWS_PER_REQUEST = 100;
const VALID_LABELS = new Set(['no_card', 'partial', 'aligned']);

type AlignmentRow = {
	session_id: string;
	user_id: string | null;
	viewfinder_x: number;
	viewfinder_y: number;
	viewfinder_width: number;
	viewfinder_height: number;
	frame_width: number;
	frame_height: number;
	user_label: string;
	label_changed_at: string;
	blur_inside: number | null;
	luminance_inside: number | null;
	edge_density_inside: number | null;
	edge_density_outside: number | null;
	border_gradient_score: number | null;
	corner_gradient_score: number | null;
	interior_variance: number | null;
	viewfinder_phash_256: string | null;
};

function coerceNumber(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return value;
}

function validateRow(raw: unknown, sessionId: string, userId: string): AlignmentRow {
	if (typeof raw !== 'object' || raw === null) {
		throw error(400, 'Each row must be an object');
	}
	const r = raw as Record<string, unknown>;

	const label = typeof r.user_label === 'string' ? r.user_label : '';
	if (!VALID_LABELS.has(label)) {
		throw error(400, `user_label must be one of: ${[...VALID_LABELS].join(', ')}`);
	}

	const intOrThrow = (v: unknown, field: string): number => {
		if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
			throw error(400, `${field} must be a non-negative integer`);
		}
		return v;
	};

	const labelChangedAt = typeof r.label_changed_at === 'string' ? r.label_changed_at : '';
	if (!labelChangedAt || Number.isNaN(Date.parse(labelChangedAt))) {
		throw error(400, 'label_changed_at must be an ISO timestamp');
	}

	const phash = typeof r.viewfinder_phash_256 === 'string' ? r.viewfinder_phash_256 : null;
	if (phash !== null && !/^[0-9a-f]{64}$/.test(phash)) {
		throw error(400, 'viewfinder_phash_256 must be 64 hex chars if present');
	}

	return {
		session_id: sessionId,
		user_id: userId,
		viewfinder_x: intOrThrow(r.viewfinder_x, 'viewfinder_x'),
		viewfinder_y: intOrThrow(r.viewfinder_y, 'viewfinder_y'),
		viewfinder_width: intOrThrow(r.viewfinder_width, 'viewfinder_width'),
		viewfinder_height: intOrThrow(r.viewfinder_height, 'viewfinder_height'),
		frame_width: intOrThrow(r.frame_width, 'frame_width'),
		frame_height: intOrThrow(r.frame_height, 'frame_height'),
		user_label: label,
		label_changed_at: labelChangedAt,
		blur_inside: coerceNumber(r.blur_inside),
		luminance_inside: coerceNumber(r.luminance_inside),
		edge_density_inside: coerceNumber(r.edge_density_inside),
		edge_density_outside: coerceNumber(r.edge_density_outside),
		border_gradient_score: coerceNumber(r.border_gradient_score),
		corner_gradient_score: coerceNumber(r.corner_gradient_score),
		interior_variance: coerceNumber(r.interior_variance),
		viewfinder_phash_256: phash
	};
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);
	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const body = await parseJsonBody<{ session_id?: unknown; rows?: unknown }>(request);

	const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
	if (!sessionId || sessionId.length > 128) {
		throw error(400, 'session_id must be a non-empty string ≤128 chars');
	}

	if (!Array.isArray(body.rows)) {
		throw error(400, 'rows must be an array');
	}
	if (body.rows.length === 0) {
		return json({ inserted: 0 });
	}
	if (body.rows.length > MAX_ROWS_PER_REQUEST) {
		throw error(400, `rows exceeds maximum of ${MAX_ROWS_PER_REQUEST} per request`);
	}

	const rows = body.rows.map((r) => validateRow(r, sessionId, user.id));

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error: dbError } = await (admin as any)
		.from('alignment_signal_telemetry')
		.insert(rows);

	if (dbError) {
		console.error('[dev/alignment-telemetry] insert failed:', dbError.message);
		throw error(500, 'Database insert failed');
	}

	return json({ inserted: rows.length });
};
