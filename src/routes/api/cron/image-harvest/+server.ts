/**
 * GET /api/cron/image-harvest — Hourly image-only harvest endpoint.
 *
 * Replaces the per-card image piggyback that used to live inside
 * /api/cron/price-harvest. That piggyback ran 288 times a day and was
 * the dominant chunk of Vercel Hobby Fluid Active CPU. This endpoint
 * runs the same image work — eBay search → first relevant listing's
 * image → sharp re-encode → Supabase Storage → cards.image_url update —
 * but on an hourly QStash schedule with a bounded batch.
 *
 * Auth: same CRON_SECRET bearer header pattern as price-harvest.
 * Triggered: directly by an Upstash QStash schedule (no qstash-harvest
 * indirection — the price-harvest chain that needs that indirection is
 * not relevant here). vercel.json has no `crons` entry; QStash remains
 * the single trigger source so we don't double-fire.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runImageCapture } from '$lib/server/harvester/image-capture';
import type { RequestHandler } from './$types';

// Vercel Hobby caps function duration at 60s.
export const config = { maxDuration: 60 };

export const GET: RequestHandler = async ({ request }) => {
	const auth = request.headers.get('authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
		console.warn('[image-harvest] Unauthorized request', {
			userAgent: request.headers.get('user-agent') ?? 'none',
			hasAuthHeader: Boolean(auth)
		});
		throw error(401, 'Unauthorized');
	}

	const started = Date.now();
	const result = await runImageCapture({ maxBatch: 20 });
	const elapsedMs = Date.now() - started;

	console.log(
		`[image-harvest] captured=${result.captured} skipped=${result.skipped} errored=${result.errored} considered=${result.considered} ms=${elapsedMs}`
	);

	return json({ ok: true, ...result, elapsedMs });
};
