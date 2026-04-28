/**
 * QStash → internal cron forwarder.
 *
 * Three of our QStash receivers do the same thing: verify the Upstash
 * signature, then internally call a `/api/cron/*` endpoint with the
 * CRON_SECRET to bypass Vercel Deployment Protection. This helper is the
 * shared body of `qstash-harvest`, `qstash-mark-stale-listings`, and
 * `qstash-vercel-mirror`.
 *
 * `qstash-check-deck-builder-version` is intentionally NOT a caller — it
 * runs its own logic rather than forwarding.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { Receiver } from '@upstash/qstash';

export interface ForwardOptions {
	/** Tag used in console logs and the response payload key. */
	logTag: string;
	/** Origin-relative path of THIS QStash endpoint, used to verify signature URL. */
	receiverPath: string;
	/** Origin-relative path of the internal cron endpoint to call. */
	targetPath: string;
	/**
	 * Optional extra request headers for the forwarded call. Useful for the
	 * harvester chain-depth headers.
	 */
	extraHeaders?: (body: string) => Record<string, string>;
	/**
	 * Key used in the success response for the target's status code.
	 * Defaults to `targetStatus`. The harvester uses `cronStatus`, mirror
	 * uses `mirrorStatus` — pass these to keep response shapes stable.
	 */
	statusKey?: string;
	/** Same as statusKey but for the response body. Defaults to `targetResponse`. */
	responseKey?: string;
}

export async function verifyAndForward(
	request: Request,
	url: URL,
	opts: ForwardOptions
) {
	const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY;
	const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY;

	if (!currentSigningKey || !nextSigningKey) {
		console.error(`[${opts.logTag}] QStash signing keys not configured`);
		return json({ error: 'QStash signing keys not configured' }, { status: 503 });
	}

	const receiver = new Receiver({ currentSigningKey, nextSigningKey });
	const body = await request.text();
	const signature = request.headers.get('upstash-signature') ?? '';

	try {
		const isValid = await receiver.verify({
			signature,
			body,
			url: `${url.origin}${opts.receiverPath}`
		});
		if (!isValid) {
			console.warn(`[${opts.logTag}] Invalid QStash signature`);
			return json({ error: 'Invalid signature' }, { status: 401 });
		}
	} catch (err) {
		console.warn(
			`[${opts.logTag}] Signature verification failed:`,
			err instanceof Error ? err.message : err
		);
		return json({ error: 'Signature verification failed' }, { status: 401 });
	}

	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		return json({ error: 'CRON_SECRET not configured' }, { status: 503 });
	}

	const targetUrl = `${url.origin}${opts.targetPath}`;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${cronSecret}`,
		...(opts.extraHeaders?.(body) ?? {})
	};
	const statusKey = opts.statusKey ?? 'targetStatus';
	const responseKey = opts.responseKey ?? 'targetResponse';

	try {
		const res = await fetch(targetUrl, { method: 'GET', headers });
		const text = await res.text();

		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			return json(
				{
					triggered: false,
					error: `Target returned non-JSON ${res.status} response`,
					detail: text.slice(0, 500)
				},
				{ status: 502 }
			);
		}

		if (!res.ok) {
			return json(
				{
					triggered: false,
					error: `Target returned HTTP ${res.status}`,
					[statusKey]: res.status,
					[responseKey]: data
				},
				{ status: 502 }
			);
		}

		return json({
			triggered: true,
			[statusKey]: res.status,
			[responseKey]: data
		});
	} catch (err) {
		return json(
			{
				triggered: false,
				error: err instanceof Error ? err.message : 'Failed to reach target endpoint'
			},
			{ status: 502 }
		);
	}
}
