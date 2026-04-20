/**
 * Per-attempt rectification diagnostic writer.
 *
 * Mirrors scan-checkpoint.ts: writes a row to rectification_attempt via a
 * direct fetch to PostgREST so a stalled supabase-js client can't prevent
 * the diagnostic itself from being recorded. Fire-and-forget; never awaits.
 *
 * Remove once rectification thresholds are tuned. This is debug infra.
 */

import { env } from '$env/dynamic/public';

let _sessionJwt: string | null = null;

export function setRectificationDiagnosticJwt(jwt: string | null): void {
	_sessionJwt = jwt;
}

export type RectificationAttemptRow = {
	trace_id: string;
	scan_id?: string | null;
	succeeded: boolean;
	confidence?: number | null;
	total_ms?: number | null;
	fail_reason?: string | null;
	src_width?: number | null;
	src_height?: number | null;
	contour_count?: number | null;
	quad_count?: number | null;
	viable_quad_count?: number | null;
	best_quad_area_ratio?: number | null;
	best_quad_aspect?: number | null;
	best_quad_score?: number | null;
	best_quad_chosen?: boolean | null;
	best_quad_reject_reason?: string | null;
	gray_ms?: number | null;
	blur_ms?: number | null;
	canny_ms?: number | null;
	dilate_ms?: number | null;
	contour_ms?: number | null;
	approx_ms?: number | null;
	warp_ms?: number | null;
	quad_points?: Array<{ x: number; y: number }> | null;
};

/** Record a rectification attempt. Fire-and-forget. */
export function recordRectificationAttempt(row: RectificationAttemptRow): void {
	try {
		const url = env.PUBLIC_SUPABASE_URL;
		const key = env.PUBLIC_SUPABASE_ANON_KEY;
		if (!url || !key) return;

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			apikey: key,
			Prefer: 'return=minimal'
		};
		if (_sessionJwt) {
			headers['Authorization'] = `Bearer ${_sessionJwt}`;
		}

		void fetch(`${url}/rest/v1/rectification_attempt`, {
			method: 'POST',
			headers,
			body: JSON.stringify(row),
			keepalive: true
		}).catch(() => {
			/* swallow */
		});
	} catch {
		/* belt-and-suspenders */
	}
}
