/**
 * POST /api/cron/qstash-archive-to-r2 — QStash signature-verifying
 * receiver for the daily archive cron.
 *
 * Forwards to /api/cron/archive-to-r2 with the CRON_SECRET so Vercel
 * Deployment Protection lets it through. Same pattern as qstash-harvest
 * and qstash-daily-maintenance.
 */

import type { RequestHandler } from './$types';
import { verifyAndForward } from '$lib/server/qstash-forward';

export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request, url }) => {
	return verifyAndForward(request, url, {
		logTag: 'qstash-archive-to-r2',
		receiverPath: '/api/cron/qstash-archive-to-r2',
		targetPath: '/api/cron/archive-to-r2',
		statusKey: 'archiveStatus',
		responseKey: 'archiveResponse'
	});
};
