/**
 * POST /api/cron/qstash-vercel-mirror — QStash-triggered Vercel log mirror.
 *
 * Receives a daily POST from QStash, verifies the signature, then internally
 * calls /api/cron/vercel-log-mirror with the CRON_SECRET to bypass Vercel
 * Deployment Protection. Same security model as qstash-harvest.
 *
 * Recommended QStash schedule: 0 6 * * * (06:00 UTC daily).
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { Receiver } from '@upstash/qstash';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

export const POST: RequestHandler = async ({ request, url }) => {
	const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY;
	const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY;

	if (!currentSigningKey || !nextSigningKey) {
		console.error('[qstash-vercel-mirror] QStash signing keys not configured');
		return json({ error: 'QStash signing keys not configured' }, { status: 503 });
	}

	const receiver = new Receiver({ currentSigningKey, nextSigningKey });

	const body = await request.text();
	const signature = request.headers.get('upstash-signature') ?? '';

	try {
		const isValid = await receiver.verify({
			signature,
			body,
			url: `${url.origin}/api/cron/qstash-vercel-mirror`
		});

		if (!isValid) {
			console.warn('[qstash-vercel-mirror] Invalid QStash signature');
			return json({ error: 'Invalid signature' }, { status: 401 });
		}
	} catch (err) {
		console.warn(
			'[qstash-vercel-mirror] Signature verification failed:',
			err instanceof Error ? err.message : err
		);
		return json({ error: 'Signature verification failed' }, { status: 401 });
	}

	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		return json({ error: 'CRON_SECRET not configured' }, { status: 503 });
	}

	const targetUrl = `${url.origin}/api/cron/vercel-log-mirror`;

	try {
		const res = await fetch(targetUrl, {
			method: 'GET',
			headers: { Authorization: `Bearer ${cronSecret}` }
		});

		const text = await res.text();
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			return json(
				{
					triggered: false,
					error: `Mirror returned non-JSON ${res.status} response`,
					detail: text.slice(0, 500)
				},
				{ status: 502 }
			);
		}

		if (!res.ok) {
			return json(
				{
					triggered: false,
					error: `Mirror returned HTTP ${res.status}`,
					mirrorStatus: res.status,
					mirrorResponse: data
				},
				{ status: 502 }
			);
		}

		return json({ triggered: true, mirrorStatus: res.status, mirrorResponse: data });
	} catch (err) {
		return json(
			{
				triggered: false,
				error: err instanceof Error ? err.message : 'Failed to reach mirror endpoint'
			},
			{ status: 502 }
		);
	}
};
