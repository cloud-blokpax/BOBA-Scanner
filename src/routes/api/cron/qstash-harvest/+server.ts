/**
 * POST /api/cron/qstash-harvest — QStash-triggered price harvest
 *
 * Receives scheduled POSTs from QStash every 5 minutes.
 * Verifies the QStash signature, then internally calls the
 * price-harvest cron endpoint (server-to-server, which bypasses
 * Vercel Deployment Protection).
 *
 * This replaces the previous setup where QStash called price-harvest
 * directly but got blocked by Vercel's 403 protection layer.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { Receiver } from '@upstash/qstash';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request, url }) => {
	// ── Verify QStash signature ───────────────────────────
	const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY;
	const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY;

	if (!currentSigningKey || !nextSigningKey) {
		console.error('[qstash-harvest] QStash signing keys not configured');
		return json({ error: 'QStash signing keys not configured' }, { status: 503 });
	}

	const receiver = new Receiver({ currentSigningKey, nextSigningKey });

	const body = await request.text();
	const signature = request.headers.get('upstash-signature') ?? '';

	try {
		const isValid = await receiver.verify({
			signature,
			body,
			url: `${url.origin}/api/cron/qstash-harvest`
		});

		if (!isValid) {
			console.warn('[qstash-harvest] Invalid QStash signature');
			return json({ error: 'Invalid signature' }, { status: 401 });
		}
	} catch (err) {
		console.warn(
			'[qstash-harvest] Signature verification failed:',
			err instanceof Error ? err.message : err
		);
		return json({ error: 'Signature verification failed' }, { status: 401 });
	}

	// ── Forward to price-harvest endpoint (internal call) ─
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		return json({ error: 'CRON_SECRET not configured' }, { status: 503 });
	}

	// Parse optional chain depth from QStash body
	let chainDepth = 0;
	try {
		if (body) {
			const parsed = JSON.parse(body);
			chainDepth = Number(parsed.chainDepth) || 0;
		}
	} catch {
		/* no body or not JSON = depth 0 */
	}

	const cronUrl = `${url.origin}/api/cron/price-harvest`;

	try {
		const res = await fetch(cronUrl, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${cronSecret}`,
				'X-Harvest-Chain-Depth': String(chainDepth),
				'X-Harvest-No-Chain': 'true',
				'X-Harvest-Time-Budget': '45000'
			}
		});

		const text = await res.text();

		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			return json(
				{
					triggered: false,
					error: `Cron returned non-JSON ${res.status} response`,
					detail: text.slice(0, 500)
				},
				{ status: 502 }
			);
		}

		if (!res.ok) {
			return json(
				{
					triggered: false,
					error: `Cron returned HTTP ${res.status}`,
					cronStatus: res.status,
					cronResponse: data
				},
				{ status: 502 }
			);
		}

		return json({
			triggered: true,
			cronStatus: res.status,
			cronResponse: data
		});
	} catch (err) {
		return json(
			{
				triggered: false,
				error: err instanceof Error ? err.message : 'Failed to reach cron endpoint'
			},
			{ status: 502 }
		);
	}
};
