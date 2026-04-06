/**
 * POST /api/admin/trigger-harvest — Manually trigger one harvest batch
 *
 * Admin-only. Fires a single cron invocation with no-chain flag.
 * The browser loops calling this endpoint for continuous harvesting.
 *
 * Returns the cron's response so the browser can decide whether to continue.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAdmin } from '$lib/server/admin-guard';
import type { RequestHandler } from './$types';

// Must match or exceed the cron endpoint's maxDuration since we await its response
export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ locals, url, request }) => {
	await requireAdmin(locals);

	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		throw error(503, 'CRON_SECRET not configured');
	}

	// Read optional chain depth from request body
	let chainDepth = 0;
	try {
		const body = await request.json();
		chainDepth = Number(body.chainDepth) || 0;
	} catch { /* no body = depth 0 */ }

	const cronUrl = `${url.origin}/api/cron/price-harvest`;

	try {
		const res = await fetch(cronUrl, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${cronSecret}`,
				'X-Harvest-Chain-Depth': String(chainDepth),
				'X-Harvest-No-Chain': 'true',
				// Give cron a shorter time budget so this wrapper function
				// has headroom to parse the response within its own 60s limit
				'X-Harvest-Time-Budget': '45000'
			}
		});

		// Read body as text first — res.json() consumes the stream,
		// making res.text() fail if JSON parsing throws.
		const text = await res.text();

		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			// Cron returned non-JSON (e.g. Vercel HTML error page)
			return json({
				triggered: false,
				error: `Cron returned non-JSON ${res.status} response`,
				detail: text.slice(0, 500)
			}, { status: 502 });
		}

		// If the cron itself returned an HTTP error, forward it
		if (!res.ok) {
			return json({
				triggered: false,
				error: `Cron returned HTTP ${res.status}`,
				cronStatus: res.status,
				cronResponse: data
			}, { status: 502 });
		}

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
