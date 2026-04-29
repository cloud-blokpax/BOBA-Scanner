/**
 * Sibling to post-one.ts that posts an existing listing_templates row
 * (instead of a scan) to WTP.
 *
 * The wtp_postings schema (migration 034) already supports source_listing_id
 * as an alternate origin; the posting-tracker already dispatches on either
 * `scan_id` or `source_listing_id`. This module just resolves a listing
 * row → card facts and then runs the same poster + tracker pipeline.
 *
 * Used by /api/wtp/post-from-listing (single) and /api/wtp/post-from-listing-batch
 * (Pro-gated bulk). Returns the same uniform shape as postOne so UI and
 * batch code can render either origin identically.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
	buildWtpPayload,
	parallelToWtpTreatmentReal,
	type BuildWtpPayloadInput
} from '$lib/services/wtp/listing-vocab';
import { ensurePending, markFailed, markPosted } from './posting-tracker';
import { postListingToWtp } from './poster';

export interface PostFromListingInput {
	source_listing_id: string;
	condition?: string;
	price?: number;
	quantity?: number;
	accepting_offers?: boolean;
	open_to_trade?: boolean;
	shipping_mode?: 'free' | 'flat' | 'per_item';
	shipping_fee?: number;
	description?: string | null;
	image_urls?: string[];
}

export type PostFromListingResult =
	| {
			ok: true;
			already_posted: boolean;
			posting_id: string;
			source_listing_id: string;
			wtp_listing_id?: string;
			wtp_url?: string;
		}
	| {
			ok: false;
			error: string;
			error_code?: string;
			posting_id?: string;
			source_listing_id: string;
		};

const SHIPPING_MODES: ReadonlyArray<'free' | 'flat' | 'per_item'> = ['free', 'flat', 'per_item'];

function readMetadataString(metadata: unknown, key: string): string | null {
	if (!metadata || typeof metadata !== 'object') return null;
	const v = (metadata as Record<string, unknown>)[key];
	return typeof v === 'string' && v.trim() ? v : null;
}

export async function postOneFromListing(
	admin: SupabaseClient,
	userId: string,
	body: PostFromListingInput
): Promise<PostFromListingResult> {
	const sourceListingId = body.source_listing_id;

	const { data: listing } = await admin
		.from('listing_templates')
		.select(
			'id, user_id, card_id, condition, price, parallel, card_number, set_code, scan_image_url, description, game_id'
		)
		.eq('id', sourceListingId)
		.eq('user_id', userId)
		.maybeSingle();

	if (!listing) {
		return {
			ok: false,
			error: 'Listing not found',
			error_code: 'listing_not_found',
			source_listing_id: sourceListingId
		};
	}
	if (!listing.card_id) {
		return {
			ok: false,
			error: 'Listing has no card_id',
			error_code: 'listing_unresolved',
			source_listing_id: sourceListingId
		};
	}

	const { data: card } = await admin
		.from('cards')
		.select('id, name, card_number, parallel, set_code, rarity, image_url, game_id, metadata')
		.eq('id', listing.card_id)
		.maybeSingle();
	if (!card) {
		return {
			ok: false,
			error: 'Card not found',
			error_code: 'card_not_found',
			source_listing_id: sourceListingId
		};
	}
	if (card.game_id !== 'wonders') {
		return {
			ok: false,
			error: 'Card is not a Wonders card',
			error_code: 'wrong_game',
			source_listing_id: sourceListingId
		};
	}

	const tracker = await ensurePending(
		admin,
		userId,
		{ source_listing_id: sourceListingId },
		card.id
	);
	if (tracker.alreadyPosted) {
		return {
			ok: true,
			already_posted: true,
			posting_id: tracker.id,
			wtp_url: tracker.wtp_listing_url ?? undefined,
			source_listing_id: sourceListingId
		};
	}

	const condition = body.condition ?? listing.condition ?? 'Near Mint';
	const price = typeof body.price === 'number' ? body.price : Number(listing.price);
	const quantity = body.quantity ?? 1;
	const acceptingOffers = body.accepting_offers ?? true;
	const openToTrade = body.open_to_trade ?? false;
	const shippingMode: 'free' | 'flat' | 'per_item' = SHIPPING_MODES.includes(
		body.shipping_mode as 'free' | 'flat' | 'per_item'
	)
		? (body.shipping_mode as 'free' | 'flat' | 'per_item')
		: 'free';
	const shippingFee = body.shipping_fee ?? 0;
	const description =
		typeof body.description !== 'undefined' ? body.description : listing.description;

	const setName =
		readMetadataString(card.metadata, 'set_display_name') ??
		card.set_code ??
		listing.set_code ??
		'Existence';
	const orbital = readMetadataString(card.metadata, 'orbital') ?? 'Boundless';
	const specialAttribute = readMetadataString(card.metadata, 'special_attribute') ?? 'None';

	const cardParallel = card.parallel ?? listing.parallel ?? 'Paper';
	const treatment = parallelToWtpTreatmentReal(cardParallel) ?? 'Paper';
	const cardNumber = card.card_number ?? listing.card_number;
	const rarity = card.rarity ?? 'Common';

	const imageUrls =
		Array.isArray(body.image_urls) && body.image_urls.length > 0
			? body.image_urls.filter((s): s is string => typeof s === 'string' && s.length > 0)
			: [listing.scan_image_url, card.image_url].filter(
					(u): u is string => typeof u === 'string' && u.length > 0
				);

	const payloadInput: BuildWtpPayloadInput = {
		card_name: card.name,
		set_name: setName,
		treatment,
		orbital,
		rarity,
		special_attribute: specialAttribute,
		card_number: cardNumber,
		condition,
		quantity,
		price,
		description: description ?? null,
		accepting_offers: acceptingOffers,
		open_to_trade: openToTrade,
		shipping_mode: shippingMode,
		shipping_fee: shippingFee
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
			source_listing_id: sourceListingId
		};
	}

	try {
		const result = await postListingToWtp(admin, userId, payload, imageUrls);
		await markPosted(admin, tracker.id, result.wtp_listing_id, result.payload, result.wtp_url);
		return {
			ok: true,
			already_posted: false,
			posting_id: tracker.id,
			wtp_listing_id: result.wtp_listing_id,
			wtp_url: result.wtp_url,
			source_listing_id: sourceListingId
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await markFailed(admin, tracker.id, msg);
		return {
			ok: false,
			error: msg,
			error_code: 'wtp_post_failed',
			posting_id: tracker.id,
			source_listing_id: sourceListingId
		};
	}
}
