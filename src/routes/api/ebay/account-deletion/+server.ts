/**
 * eBay Marketplace Account Deletion / Closure Notification Endpoint
 *
 * Required by eBay for production keyset activation. eBay calls this endpoint
 * in two ways:
 *
 *   1. GET ?challenge_code=<random>   — Initial verification. We respond with
 *      sha256(challengeCode + verificationToken + endpointURL) as hex, inside
 *      `{"challengeResponse": "<hex>"}` with Content-Type: application/json.
 *      eBay re-issues this challenge whenever the developer console "Verify
 *      endpoint" button is pressed.
 *
 *   2. POST {metadata, notification}  — Real deletion event. eBay sends this
 *      when a user closes their eBay account. We find the matching row in
 *      ebay_seller_tokens and delete it. Response must be 2xx within ~3s.
 *
 * The endpoint is unauthenticated by design — eBay calls from their servers
 * with no shared credentials. Authenticity is established by:
 *   - On GET: only an actor who knows the verificationToken (stored only in
 *     Vercel env + the eBay dev console) can produce a matching hash.
 *   - On POST: by the X-EBAY-SIGNATURE header (Phase 2 — not verified yet).
 *
 * Phase 2 hardening (NOT in this commit): verify X-EBAY-SIGNATURE against
 * eBay's getPublicKey API. See the bottom of the implementation doc.
 *
 * Reference: https://developer.ebay.com/marketplace-account-deletion
 */

import { json, error } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getAdminClient } from '$lib/server/supabase-admin';
import { logEvent } from '$lib/server/diagnostics';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 10 };

// The exact URL we registered with eBay. Keep in sync with the value pasted
// into the eBay developer console under "Notification Endpoint URL".
const ENDPOINT_URL = 'https://boba.cards/api/ebay/account-deletion';

/**
 * GET /api/ebay/account-deletion?challenge_code=...
 *
 * eBay's endpoint-verification handshake. Must return:
 *   - status 200
 *   - Content-Type: application/json (SvelteKit's `json()` sets this)
 *   - body {"challengeResponse": "<sha256-hex>"}
 *
 * Where the hash is over the concatenation:
 *   challenge_code  +  verificationToken  +  endpointURL
 * Returned as lowercase hexadecimal. NOT base64. Order matters.
 */
export const GET: RequestHandler = async ({ url }) => {
	const challengeCode = url.searchParams.get('challenge_code');
	const verificationToken = env.EBAY_DELETION_VERIFICATION_TOKEN ?? '';

	if (!challengeCode) {
		// Direct browser hit, health check, or someone poking the endpoint.
		// Return a small response so it's clear the endpoint exists.
		return json({ status: 'ok', message: 'eBay account-deletion endpoint' });
	}

	if (!verificationToken) {
		console.error('[ebay/account-deletion] EBAY_DELETION_VERIFICATION_TOKEN not configured');
		void logEvent({
			level: 'fatal',
			event: 'ebay.account_deletion.token_not_configured',
			source: 'server',
			requestPath: '/api/ebay/account-deletion'
		});
		throw error(500, 'Endpoint not configured');
	}

	const hash = createHash('sha256');
	hash.update(challengeCode);
	hash.update(verificationToken);
	hash.update(ENDPOINT_URL);
	const challengeResponse = hash.digest('hex');

	void logEvent({
		level: 'info',
		event: 'ebay.account_deletion.challenge_handshake',
		source: 'server',
		context: { challenge_code_prefix: challengeCode.slice(0, 8) },
		requestPath: '/api/ebay/account-deletion'
	});

	return json({ challengeResponse });
};

/**
 * POST /api/ebay/account-deletion
 *
 * eBay sends a deletion notification with:
 *   {
 *     "metadata": { "topic": "MARKETPLACE_ACCOUNT_DELETION", ... },
 *     "notification": {
 *       "notificationId": "...",
 *       "eventDate": "...",
 *       "publishDate": "...",
 *       "publishAttemptCount": 1,
 *       "data": {
 *         "username": "...",
 *         "userId": "...",      // stable eBay user ID — primary match key
 *         "eiasToken": "..."
 *       }
 *     }
 *   }
 *
 * Response must be 2xx within ~3 seconds or eBay will retry.
 *
 * We acknowledge eagerly (200 OK), then process the deletion. This pattern
 * ensures eBay never marks the endpoint as failing — a slow DB call here
 * would lead to retries and eventually subscription suspension.
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: EbayDeletionNotification;
	try {
		body = (await request.json()) as EbayDeletionNotification;
	} catch (err) {
		console.error('[ebay/account-deletion] Invalid JSON body:', err);
		void logEvent({
			level: 'warn',
			event: 'ebay.account_deletion.invalid_payload',
			source: 'server',
			error: err,
			requestPath: '/api/ebay/account-deletion'
		});
		// Still return 200 — we don't want eBay to retry malformed payloads
		// (which are almost certainly not from eBay anyway).
		return json({ ok: true });
	}

	const notification = body?.notification;
	const data = notification?.data;
	const topic = body?.metadata?.topic;

	if (topic !== 'MARKETPLACE_ACCOUNT_DELETION' || !data?.userId) {
		void logEvent({
			level: 'warn',
			event: 'ebay.account_deletion.unexpected_topic',
			source: 'server',
			context: { topic, has_user_id: !!data?.userId, notification_id: notification?.notificationId },
			requestPath: '/api/ebay/account-deletion'
		});
		return json({ ok: true });
	}

	// Process the deletion. Fire-and-forget so we can ACK fast — eBay only
	// cares that we returned 2xx. Errors land in app_events.
	void processAccountDeletion(data, notification?.notificationId ?? null);

	return json({ ok: true });
};

interface EbayDeletionNotification {
	metadata?: {
		topic?: string;
		schemaVersion?: string;
		deprecated?: boolean;
	};
	notification?: {
		notificationId?: string;
		eventDate?: string;
		publishDate?: string;
		publishAttemptCount?: number;
		data?: {
			username?: string;
			userId?: string;
			eiasToken?: string;
		};
	};
}

async function processAccountDeletion(
	data: { username?: string; userId?: string; eiasToken?: string },
	notificationId: string | null
): Promise<void> {
	const admin = getAdminClient();
	if (!admin) {
		console.error('[ebay/account-deletion] Admin client unavailable — cannot process deletion');
		void logEvent({
			level: 'fatal',
			event: 'ebay.account_deletion.admin_client_unavailable',
			source: 'server',
			context: { notification_id: notificationId, ebay_user_id: data.userId }
		});
		return;
	}

	// Primary match: stable eBay user ID. Fallback: username (for rows that
	// connected before ebay_user_id was being populated).
	let { data: matchedRows, error: lookupErr } = await admin
		.from('ebay_seller_tokens')
		.select('user_id, ebay_user_id, ebay_username')
		.eq('ebay_user_id', data.userId);

	if (lookupErr) {
		console.error('[ebay/account-deletion] Lookup by ebay_user_id failed:', lookupErr.message);
	}

	if ((!matchedRows || matchedRows.length === 0) && data.username) {
		const fallback = await admin
			.from('ebay_seller_tokens')
			.select('user_id, ebay_user_id, ebay_username')
			.eq('ebay_username', data.username);
		matchedRows = fallback.data ?? [];
	}

	if (!matchedRows || matchedRows.length === 0) {
		// No row matched. This is normal — eBay sends deletions for ALL of
		// their users who close accounts, not just ones connected to our app.
		void logEvent({
			level: 'info',
			event: 'ebay.account_deletion.no_match',
			source: 'server',
			context: { notification_id: notificationId, ebay_user_id: data.userId }
		});
		return;
	}

	// Delete every matched row. There should normally be exactly one.
	const internalUserIds = matchedRows.map(r => r.user_id);
	const { error: deleteErr } = await admin
		.from('ebay_seller_tokens')
		.delete()
		.in('user_id', internalUserIds);

	if (deleteErr) {
		console.error('[ebay/account-deletion] Delete failed:', deleteErr.message);
		void logEvent({
			level: 'error',
			event: 'ebay.account_deletion.delete_failed',
			source: 'server',
			error: deleteErr,
			context: {
				notification_id: notificationId,
				ebay_user_id: data.userId,
				matched_count: matchedRows.length
			}
		});
		return;
	}

	void logEvent({
		level: 'info',
		event: 'ebay.account_deletion.processed',
		source: 'server',
		context: {
			notification_id: notificationId,
			ebay_user_id: data.userId,
			deleted_rows: matchedRows.length,
			matched_internal_user_ids: internalUserIds
		}
	});
}
