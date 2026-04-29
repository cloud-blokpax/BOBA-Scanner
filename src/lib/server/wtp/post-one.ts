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
import {
	buildWtpPayload,
	parallelToWtpTreatmentReal,
	type BuildWtpPayloadInput
} from '$lib/services/wtp/listing-vocab';
import { ensurePending, markPosted, markFailed } from './posting-tracker';
import { postListingToWtp } from './poster';

export interface PostOneInput {
	scan_id: string;
	// Optional card-identity overrides — composer lets the user edit any field.
	card_name?: string;
	set_name?: string;
	treatment?: string;
	orbital?: string;
	rarity?: string;
	special_attribute?: string;
	card_number?: string | null;
	// Listing details
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

function readMetadataString(metadata: unknown, key: string): string | null {
	if (!metadata || typeof metadata !== 'object') return null;
	const v = (metadata as Record<string, unknown>)[key];
	return typeof v === 'string' && v.trim() ? v : null;
}

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
		return {
			ok: false,
			error: 'Scan not found or unresolved',
			error_code: 'scan_not_found',
			scan_id: body.scan_id
		};
	}

	const { data: card } = await admin
		.from('cards')
		.select('id, name, card_number, parallel, set_code, rarity, game_id, metadata')
		.eq('id', scan.final_card_id)
		.maybeSingle();
	if (!card) {
		return {
			ok: false,
			error: 'Card not found',
			error_code: 'card_not_found',
			scan_id: body.scan_id
		};
	}
	if (card.game_id !== 'wonders') {
		return {
			ok: false,
			error: 'Card is not a Wonders card',
			error_code: 'wrong_game',
			scan_id: body.scan_id
		};
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

	const setNameDefault =
		readMetadataString(card.metadata, 'set_display_name') ?? card.set_code ?? 'Existence';
	const orbitalDefault = readMetadataString(card.metadata, 'orbital') ?? 'Boundless';
	const specialDefault = readMetadataString(card.metadata, 'special_attribute') ?? 'None';
	const treatmentDefault = parallelToWtpTreatmentReal(card.parallel ?? 'Paper') ?? 'Paper';
	const rarityDefault = card.rarity ?? 'Common';

	const payloadInput: BuildWtpPayloadInput = {
		card_name: body.card_name ?? card.name,
		set_name: body.set_name ?? setNameDefault,
		treatment: body.treatment ?? treatmentDefault,
		orbital: body.orbital ?? orbitalDefault,
		rarity: body.rarity ?? rarityDefault,
		special_attribute: body.special_attribute ?? specialDefault,
		card_number:
			typeof body.card_number !== 'undefined' ? body.card_number : card.card_number,
		condition: body.condition,
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
		return {
			ok: false,
			error: msg,
			error_code: 'invalid_payload',
			posting_id: tracker.id,
			scan_id: body.scan_id
		};
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
		return {
			ok: false,
			error: msg,
			error_code: 'wtp_post_failed',
			posting_id: tracker.id,
			scan_id: body.scan_id
		};
	}
}
