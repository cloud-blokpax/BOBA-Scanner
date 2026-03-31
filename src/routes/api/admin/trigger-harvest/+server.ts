/**
 * POST /api/admin/trigger-harvest — Manually trigger the price harvest cron
 *
 * Admin-only endpoint. Kicks off the self-chaining harvest by calling
 * the cron endpoint with CRON_SECRET auth.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAdmin } from '$lib/server/admin-guard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		throw error(503, 'CRON_SECRET not configured');
	}

	const cronUrl = `${url.origin}/api/cron/price-harvest`;

	try {
		const res = await fetch(cronUrl, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${cronSecret}`,
				'X-Harvest-Chain-Depth': '0'
			}
		});

		const data = await res.json();
		return json({
			triggered: true,
			cronStatus: res.status,
			cronResponse: data
		});
	} catch (err) {
		return json({
			triggered: false,
			error: err instanceof Error ? err.message : 'Failed to reach cron endpoint'
		}, { status: 502 });
	}
};
