/**
 * GET /api/cron/vercel-log-mirror — Vercel runtime log mirror.
 *
 * Triggered by QStash (via /api/cron/qstash-vercel-mirror, server-to-server,
 * bypassing Vercel Deployment Protection). Pulls the last 24 hours of Vercel
 * runtime logs for production deployments, filters to errors/warnings, dedupes
 * against existing app_events rows, and inserts the missing ones with
 * source='edge'.
 *
 * Catches the failure classes that never reach SvelteKit's handleError:
 *   - Function timeouts (Vercel kills the runtime before SvelteKit can react)
 *   - OOM kills
 *   - Cold-start / module-level import failures
 *   - Edge/middleware crashes (in middleware.ts before handle chain runs)
 *
 * Auth: CRON_SECRET header. The qstash-vercel-mirror endpoint injects this
 * after verifying the QStash signature.
 *
 * Required env:
 *   - VERCEL_API_TOKEN  (read scope on the project)
 *   - VERCEL_PROJECT_ID
 *   - VERCEL_TEAM_ID
 *   - CRON_SECRET
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';
import { getAdminClient } from '$lib/server/supabase-admin';
import { logEvent } from '$lib/server/diagnostics';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

interface VercelDeployment {
	uid: string;
	target?: string | null;
}

interface VercelLogEntry {
	timestamp?: number;
	type?: string;
	level?: string;
	message?: string;
	requestId?: string;
	source?: string;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_DEPLOYMENTS = 20;
const MESSAGE_EXCERPT_LEN = 1500;

export const GET: RequestHandler = async ({ request }) => {
	// ── Auth ────────────────────────────────────────────────
	const auth = request.headers.get('authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
		throw error(401, 'unauthorized');
	}

	const token = env.VERCEL_API_TOKEN;
	const projectId = env.VERCEL_PROJECT_ID;
	const teamId = env.VERCEL_TEAM_ID;
	if (!token || !projectId || !teamId) {
		throw error(503, 'Vercel API credentials not configured');
	}

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database unavailable');

	const since = Date.now() - WINDOW_MS;

	// ── Pull recent production deployments ──────────────────
	const deploysUrl =
		`https://api.vercel.com/v6/deployments?projectId=${projectId}` +
		`&teamId=${teamId}&since=${since}&target=production&limit=${MAX_DEPLOYMENTS}`;

	let deployments: VercelDeployment[] = [];
	try {
		const res = await fetch(deploysUrl, { headers: { Authorization: `Bearer ${token}` } });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			void logEvent({
				level: 'error',
				event: 'vercel_mirror.deployments_fetch_failed',
				errorCode: String(res.status),
				context: { body_excerpt: body.slice(0, 500) }
			});
			throw error(503, `Vercel deployments fetch returned ${res.status}`);
		}
		const data = (await res.json()) as { deployments?: VercelDeployment[] };
		deployments = data.deployments ?? [];
	} catch (err) {
		void logEvent({
			level: 'error',
			event: 'vercel_mirror.deployments_fetch_threw',
			error: err
		});
		throw err;
	}

	// ── Pull logs per deployment, filter, dedupe, insert ────
	let inserted = 0;
	let skipped = 0;
	let errored = 0;

	for (const d of deployments) {
		const logsUrl =
			`https://api.vercel.com/v2/deployments/${d.uid}/events?teamId=${teamId}` +
			`&since=${since}&types=stderr,stdout,fatal`;

		let logs: VercelLogEntry[] = [];
		try {
			const res = await fetch(logsUrl, { headers: { Authorization: `Bearer ${token}` } });
			if (!res.ok) {
				errored++;
				continue;
			}
			const data = await res.json();
			logs = Array.isArray(data) ? data : [];
		} catch {
			errored++;
			continue;
		}

		for (const log of logs) {
			// Filter: only stderr or warning/error level. Skip request-access lines.
			const isError =
				log.type === 'stderr' || log.type === 'fatal' ||
				log.level === 'error' || log.level === 'warning';
			if (!isError) continue;

			const message = typeof log.message === 'string' ? log.message : '';
			if (!message) continue;

			// Skip events we likely already have via handleError mirror — they
			// land in app_events via the structured 'unhandled_error' line.
			if (message.includes('"type":"unhandled_error"') || message.includes('"type":"diag_event"')) {
				skipped++;
				continue;
			}

			// Dedupe on (message hash + minute-rounded timestamp).
			const ts = typeof log.timestamp === 'number' ? log.timestamp : Date.now();
			const dedupKey = createHash('md5')
				.update(`${message}:${Math.floor(ts / 60_000)}`)
				.digest('hex');

			const { data: existing } = await admin
				.from('app_events')
				.select('id')
				.eq('event_name', 'vercel.runtime.error')
				.eq('error_code', dedupKey)
				.maybeSingle();

			if (existing) {
				skipped++;
				continue;
			}

			const level = log.level === 'warning' ? 'warn' : 'error';
			const id = await logEvent({
				level,
				event: 'vercel.runtime.error',
				source: 'edge',
				errorCode: dedupKey,
				error: message.slice(0, MESSAGE_EXCERPT_LEN),
				context: {
					vercel_deploy_id: d.uid,
					vercel_request_id: log.requestId ?? null,
					vercel_source: log.source ?? null,
					original_timestamp: new Date(ts).toISOString()
				},
				vercelRequestId: log.requestId ?? null
			});

			if (id !== null) inserted++;
			else errored++;
		}
	}

	return json({
		inserted,
		skipped,
		errored,
		deployments_scanned: deployments.length,
		since: new Date(since).toISOString()
	});
};
