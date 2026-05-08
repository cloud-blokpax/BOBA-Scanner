/**
 * POST /api/cron/qstash-wtp-scrape — QStash signature-verifying receiver.
 *
 * Forwards to /api/cron/wtp-scrape with the CRON_SECRET so Vercel
 * Deployment Protection lets it through. Same pattern as qstash-harvest,
 * qstash-daily-maintenance, qstash-archive-to-r2.
 */

import type { RequestHandler } from './$types';
import { verifyAndForward } from '$lib/server/qstash-forward';

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request, url }) => {
	return verifyAndForward(request, url, {
		logTag: 'qstash-wtp-scrape',
		receiverPath: '/api/cron/qstash-wtp-scrape',
		targetPath: '/api/cron/wtp-scrape',
		statusKey: 'wtpStatus',
		responseKey: 'wtpResponse'
	});
};
