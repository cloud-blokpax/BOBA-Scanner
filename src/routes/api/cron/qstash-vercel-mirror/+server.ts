/**
 * POST /api/cron/qstash-vercel-mirror — daily QStash trigger for the Vercel
 * log mirror job.
 *
 * Recommended QStash schedule: 0 6 * * * (06:00 UTC daily).
 * Forward logic lives in $lib/server/qstash-forward.
 */

import { verifyAndForward } from '$lib/server/qstash-forward';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request, url }) => {
	return verifyAndForward(request, url, {
		logTag: 'qstash-vercel-mirror',
		receiverPath: '/api/cron/qstash-vercel-mirror',
		targetPath: '/api/cron/vercel-log-mirror',
		statusKey: 'mirrorStatus',
		responseKey: 'mirrorResponse'
	});
};
