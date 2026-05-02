/**
 * /api/admin/detector-labels/save — Persist a human reviewer's decision on
 * a single detector_training_labels row. Drives the active-learning loop
 * for Phase 3 Doc 3.0.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/require-admin';
import { getAdminClient } from '$lib/server/supabase-admin';
import { parseJsonBody } from '$lib/server/validate';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

type Decision = 'human_confirmed' | 'human_corrected' | 'rejected';
const VALID_DECISIONS: Decision[] = ['human_confirmed', 'human_corrected', 'rejected'];

interface SaveBody {
	id?: string;
	label_state?: Decision;
	corners_px?: number[][] | null;
	reject_reason?: string | null;
}

function isCornerArray(value: unknown): value is number[][] {
	if (!Array.isArray(value) || value.length !== 4) return false;
	return value.every(
		(p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n))
	);
}

export const POST: RequestHandler = async (event) => {
	const { user } = await requireAdmin(event);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json(
			{ error: 'Too many requests' },
			{
				status: 429,
				headers: {
					'X-RateLimit-Limit': String(rateLimit.limit),
					'X-RateLimit-Remaining': String(rateLimit.remaining),
					'X-RateLimit-Reset': String(rateLimit.reset)
				}
			}
		);
	}

	const body = await parseJsonBody<SaveBody>(event.request);
	const { id, label_state, corners_px, reject_reason } = body;

	if (!id || typeof id !== 'string') throw error(400, 'missing id');
	if (!label_state || !VALID_DECISIONS.includes(label_state)) {
		throw error(400, 'invalid label_state');
	}
	if (label_state === 'rejected') {
		if (!reject_reason || typeof reject_reason !== 'string') {
			throw error(400, 'reject_reason required when rejecting');
		}
	}
	if (corners_px !== null && corners_px !== undefined && !isCornerArray(corners_px)) {
		throw error(400, 'corners_px must be a 4x2 number array or null');
	}

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database not available');

	const nowIso = new Date().toISOString();
	const updates: Record<string, unknown> = {
		label_state,
		corners_px: corners_px ?? null,
		reject_reason: label_state === 'rejected' ? reject_reason : null,
		reviewed_by: user.id,
		reviewed_at: nowIso,
		updated_at: nowIso
	};

	// detector_training_labels isn't in the regenerated database types yet —
	// the table is new (migration 20260502000007). Cast the client to `any`
	// to bypass the typed-table constraint at the call site rather than
	// hand-edit the generated database.ts.
	const adminUntyped = admin as unknown as {
		from: (table: string) => {
			update: (values: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<{ error: unknown }> };
		};
	};
	const { error: dbErr } = await adminUntyped
		.from('detector_training_labels')
		.update(updates)
		.eq('id', id);

	if (dbErr) {
		console.error('[detector-labels/save] db err', dbErr);
		throw error(500, 'save failed');
	}

	return json({ ok: true });
};
