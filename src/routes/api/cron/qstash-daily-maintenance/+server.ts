/**
 * POST /api/cron/qstash-daily-maintenance — daily QStash trigger for the
 * eBay listing observation tables maintenance job.
 *
 * Recommended QStash schedule: 0 4 * * * (04:00 UTC daily).
 * Forward logic lives in $lib/server/qstash-forward.
 */

import { verifyAndForward } from '$lib/server/qstash-forward';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request, url }) => {
	return verifyAndForward(request, url, {
		logTag: 'qstash-daily-maintenance',
		receiverPath: '/api/cron/qstash-daily-maintenance',
		targetPath: '/api/cron/daily-maintenance'
	});
};
