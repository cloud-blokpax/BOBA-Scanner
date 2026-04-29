/**
 * Tracks the lifecycle of WTP postings in the wtp_postings table.
 *
 * ensurePending → markPosted | markFailed
 *
 * Idempotency: the (user_id, scan_id) and (user_id, source_listing_id)
 * unique partial indexes prevent the same origin from being posted
 * twice. ensurePending returns alreadyPosted=true when a successful
 * row already exists, which the caller uses to short-circuit.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type PostingOrigin = { scan_id: string } | { source_listing_id: string };

export interface EnsureResult {
	id: string;
	alreadyPosted: boolean;
	alreadyFailed: boolean;
	wtp_listing_url?: string | null;
}

export async function ensurePending(
	admin: SupabaseClient,
	userId: string,
	origin: PostingOrigin,
	cardId: string
): Promise<EnsureResult> {
	let q = admin
		.from('wtp_postings')
		.select('id, status, wtp_listing_url')
		.eq('user_id', userId);
	if ('scan_id' in origin) q = q.eq('scan_id', origin.scan_id);
	else q = q.eq('source_listing_id', origin.source_listing_id);

	const existing = await q.maybeSingle();
	if (existing.error) throw existing.error;

	if (existing.data) {
		return {
			id: existing.data.id,
			alreadyPosted:
				existing.data.status === 'posted' ||
				existing.data.status === 'sold' ||
				existing.data.status === 'ended',
			alreadyFailed: existing.data.status === 'failed',
			wtp_listing_url: existing.data.wtp_listing_url ?? null
		};
	}

	const insertRow: Record<string, unknown> = {
		user_id: userId,
		card_id: cardId,
		status: 'pending'
	};
	if ('scan_id' in origin) insertRow.scan_id = origin.scan_id;
	else insertRow.source_listing_id = origin.source_listing_id;

	const { data, error } = await admin
		.from('wtp_postings')
		.insert(insertRow)
		.select('id')
		.single();
	if (error) throw error;
	return { id: data.id, alreadyPosted: false, alreadyFailed: false };
}

export async function markPosted(
	admin: SupabaseClient,
	postingId: string,
	wtpListingId: string,
	payload: unknown,
	wtpUrl?: string
): Promise<void> {
	const { error } = await admin
		.from('wtp_postings')
		.update({
			status: 'posted',
			wtp_listing_id: wtpListingId,
			wtp_listing_url: wtpUrl ?? null,
			payload,
			error_message: null,
			posted_at: new Date().toISOString(),
			last_synced_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		})
		.eq('id', postingId);
	if (error) throw error;
}

export async function markFailed(
	admin: SupabaseClient,
	postingId: string,
	errorMessage: string
): Promise<void> {
	const { error } = await admin
		.from('wtp_postings')
		.update({
			status: 'failed',
			error_message: errorMessage.slice(0, 1000),
			updated_at: new Date().toISOString()
		})
		.eq('id', postingId);
	if (error) throw error;
}

export async function syncPosted(
	admin: SupabaseClient,
	postingId: string,
	patch: { status?: 'posted' | 'sold' | 'ended'; wtp_listing_url?: string | null }
): Promise<void> {
	const { error } = await admin
		.from('wtp_postings')
		.update({
			...patch,
			last_synced_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		})
		.eq('id', postingId);
	if (error) throw error;
}
