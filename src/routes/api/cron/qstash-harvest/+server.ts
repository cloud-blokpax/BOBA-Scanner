/**
 * POST /api/cron/qstash-harvest — QStash-triggered price harvest.
 *
 * Receives scheduled POSTs from QStash every 5 minutes. Verifies the QStash
 * signature, then forwards server-to-server to /api/cron/price-harvest with
 * CRON_SECRET to bypass Vercel Deployment Protection.
 *
 * Forward logic lives in $lib/server/qstash-forward.
 */

import { verifyAndForward } from '$lib/server/qstash-forward';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request, url }) => {
	return verifyAndForward(request, url, {
		logTag: 'qstash-harvest',
		receiverPath: '/api/cron/qstash-harvest',
		targetPath: '/api/cron/price-harvest',
		statusKey: 'cronStatus',
		responseKey: 'cronResponse',
		extraHeaders: (body) => {
			let chainDepth = 0;
			try {
				if (body) {
					const parsed = JSON.parse(body);
					chainDepth = Number(parsed.chainDepth) || 0;
				}
			} catch {
				/* no body or not JSON = depth 0 */
			}
			return {
				'X-Harvest-Chain-Depth': String(chainDepth),
				'X-Harvest-No-Chain': 'true',
				'X-Harvest-Time-Budget': '45000'
			};
		}
	});
};
