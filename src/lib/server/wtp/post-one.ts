/**
 * Single-card "post to WTP" pipeline:
 *   1. Resolve scan → card (Wonders only)
 *   2. ensurePending in wtp_postings (idempotent)
 *   3. buildWtpPayload from form values + card facts
 *   4. postListingToWtp (relay images + POST listing)
 *   5. markPosted | markFailed
 *
 * Used by both /api/wtp/post and /api/wtp/post-batch. Returns a
 * uniform shape so the batch endpoint can collect per-item results.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildWtpPayload, type BuildWtpPayloadInput } from '$lib/services/wtp/listing-vocab';
import { ensurePending, markPosted, markFailed } from './posting-tracker';
import { postListingToWtp } from './poster';

export interface PostOneInput {
	scan_id: string;
	condition: string;
	price: number;
	quantity: number;
	accepting_offers: boolean;
	open_to_trade: boolean;
	shipping_mode: 'free' | 'flat' | 'per_item';
	shipping_fee: number;
	description: string | null;
	image_urls: string[];
}

export type PostOneResult =
	| {
			ok: true;
			already_posted: boolean;
			posting_id: string;
			wtp_listing_id?: string;
			wtp_url?: string;
			scan_id: string;
		}
	| {
			ok: false;
			error: string;
			error_code?: string;
			posting_id?: string;
			scan_id: string;
		};

export async function postOne(
	admin: SupabaseClient,
	userId: string,
	body: PostOneInput
): Promise<PostOneResult> {
	const { data: scan } = await admin
		.from('scans')
		.select('id, user_id, final_card_id')
		.eq('id', body.scan_id)
		.eq('user_id', userId)
		.maybeSingle();
	if (!scan?.final_card_id) {
		return { ok: false, error: 'Scan not found or unresolved', error_code: 'scan_not_found', scan_id: body.scan_id };
	}

	const { data: card } = await admin
		.from('cards')
		.select('id, name, card_number, parallel, set_code, rarity, game_id, metadata')
		.eq('id', scan.final_card_id)
		.maybeSingle();
	if (!card) {
		return { ok: false, error: 'Card not found', error_code: 'card_not_found', scan_id: body.scan_id };
	}
	if (card.game_id !== 'wonders') {
		return { ok: false, error: 'Card is not a Wonders card', error_code: 'wrong_game', scan_id: body.scan_id };
	}

	const tracker = await ensurePending(admin, userId, { scan_id: body.scan_id }, card.id);
	if (tracker.alreadyPosted) {
		return {
			ok: true,
			already_posted: true,
			posting_id: tracker.id,
			wtp_url: tracker.wtp_listing_url ?? undefined,
			scan_id: body.scan_id
		};
	}

	const metadata = (card.metadata ?? {}) as Record<string, unknown>;
	const setName = (typeof metadata.set_display_name === 'string' && metadata.set_display_name) || card.set_code || null;
	const orbital = typeof metadata.orbital === 'string' ? metadata.orbital : null;
	const specialAttribute = typeof metadata.special_attribute === 'string' ? metadata.special_attribute : null;

	const payloadInput: BuildWtpPayloadInput = {
		card_id: card.id,
		card_name: card.name,
		parallel: card.parallel ?? 'Paper',
		condition: body.condition,
		rarity: card.rarity,
		orbital,
		set_name: setName,
		special_attribute: specialAttribute,
		card_number: card.card_number,
		quantity: body.quantity,
		price: body.price,
		description: body.description,
		accepting_offers: body.accepting_offers,
		open_to_trade: body.open_to_trade,
		shipping_mode: body.shipping_mode,
		shipping_fee: body.shipping_fee
	};

	let payload;
	try {
		payload = buildWtpPayload(payloadInput);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await markFailed(admin, tracker.id, msg);
		return { ok: false, error: msg, error_code: 'invalid_payload', posting_id: tracker.id, scan_id: body.scan_id };
	}

	try {
		const result = await postListingToWtp(admin, userId, payload, body.image_urls);
		await markPosted(admin, tracker.id, result.wtp_listing_id, result.payload, result.wtp_url);
		return {
			ok: true,
			already_posted: false,
			posting_id: tracker.id,
			wtp_listing_id: result.wtp_listing_id,
			wtp_url: result.wtp_url,
			scan_id: body.scan_id
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await markFailed(admin, tracker.id, msg);
		return { ok: false, error: msg, error_code: 'wtp_post_failed', posting_id: tracker.id, scan_id: body.scan_id };
	}
}
