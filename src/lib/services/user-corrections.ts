/**
 * Phase 8 — Tap-to-teach user correction capture.
 *
 * Fire-and-forget POST to scan_user_corrections. Never blocks the scan
 * flow; null Supabase client silently no-ops. Failures land in console.debug
 * but don't surface as user-facing errors — the correction is a bonus
 * signal, not a critical write.
 */

import { getSupabase } from './supabase';

export type CorrectionType =
	| 'corner_tap_4'
	| 'quad_adjust'
	| 'card_id_override'
	| 'abandon';

export interface CornerPoint {
	x: number;
	y: number;
}

export interface SubmitUserCorrectionInput {
	scanId: string;
	correctionType: CorrectionType;
	originalCorners?: CornerPoint[] | null;
	correctedCorners?: CornerPoint[] | null;
	originalCardId?: string | null;
	correctedCardId?: string | null;
	correctionLatencyMs?: number | null;
}

export async function submitUserCorrection(
	input: SubmitUserCorrectionInput
): Promise<void> {
	const client = getSupabase();
	if (!client) return;
	try {
		// Cast through unknown — the generated Supabase Database type doesn't
		// yet know about scan_user_corrections (added in migration 077). Will
		// disappear once `npm run db:types` runs against post-migration prod.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const table = (client.from as any)('scan_user_corrections');
		const { error } = await table.insert({
			scan_id: input.scanId,
			correction_type: input.correctionType,
			original_corners: input.originalCorners ?? null,
			corrected_corners: input.correctedCorners ?? null,
			original_card_id: input.originalCardId ?? null,
			corrected_card_id: input.correctedCardId ?? null,
			correction_latency_ms: input.correctionLatencyMs ?? null
		});
		if (error) {
			console.debug('[user-corrections] insert failed', error);
		}
	} catch (err) {
		console.debug('[user-corrections] threw, swallowed', err);
	}
}
