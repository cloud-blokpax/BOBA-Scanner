/**
 * Pipeline checkpoint writer for rectification debugging.
 *
 * Writes a row to scan_pipeline_checkpoint via direct fetch to PostgREST
 * (not supabase-js) so that a stalled supabase-js client can't prevent
 * the checkpoint itself from being recorded.
 *
 * Fire-and-forget. Never awaits, never throws. If the write fails we lose
 * a diagnostic row; we never lose a scan.
 *
 * REMOVE AFTER RECTIFICATION IS VERIFIED WORKING. This is debug infra.
 */

import { env } from '$env/dynamic/public';

let _sessionJwt: string | null = null;

export function setCheckpointJwt(jwt: string | null): void {
	_sessionJwt = jwt;
}

/**
 * Record a checkpoint. Fire-and-forget.
 * @param traceId   Stable ID tying all checkpoints for one scan together
 * @param stage     Short name of the pipeline stage (e.g. 'tier1:start')
 * @param elapsedMs Ms since scan start (performance.now() - startTime)
 * @param extras    Optional small object with diagnostic context
 */
export function checkpoint(
	traceId: string,
	stage: string,
	elapsedMs: number,
	extras?: Record<string, unknown>
): void {
	try {
		const url = env.PUBLIC_SUPABASE_URL;
		const key = env.PUBLIC_SUPABASE_ANON_KEY;
		if (!url || !key) return;

		const body = JSON.stringify({
			trace_id: traceId,
			stage,
			elapsed_ms: Math.round(elapsedMs),
			extras: extras ?? {}
		});
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			apikey: key,
			Prefer: 'return=minimal'
		};
		if (_sessionJwt) {
			headers['Authorization'] = `Bearer ${_sessionJwt}`;
		}
		// Fire-and-forget. No await. Any error is silently dropped.
		void fetch(`${url}/rest/v1/scan_pipeline_checkpoint`, {
			method: 'POST',
			headers,
			body,
			keepalive: true
		}).catch(() => {
			/* swallow */
		});
	} catch {
		/* belt-and-suspenders */
	}
}
