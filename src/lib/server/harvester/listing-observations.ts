/**
 * Per-listing observation persistence for the eBay price harvester.
 *
 * The price-harvest cron fetches the full eBay item summary for every card it
 * prices. This module persists the per-listing detail to two tables — both
 * fed entirely from data already parsed in memory by the cron. Strict rule:
 * NEVER fetches a byte over HTTP, runs no `sharp`, uploads nothing to Storage.
 *
 *  - `ebay_listing_observations` — one row per (listing × cycle), 30-day
 *    retention. High volume; powers filter regression hunting, sold-price
 *    inference, seller intelligence, per-condition pricing breakouts.
 *  - `ebay_card_images` — one row per unique (card_id, ebay_item_id), keep
 *    forever. Asymptotes naturally because new listings are bounded.
 *
 * Best-effort by contract: the persist call is wrapped in try/catch by the
 * caller. Any thrown error here is logged and swallowed so price harvesting
 * stays unaffected. Price math + price_cache + price_harvest_log writes are
 * the primary mission; observations are bonus data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

/** Filter decision attached to each raw eBay item by the harvester. */
export interface ListingObservationDecision {
	accepted: boolean;
	rejection_reason: string | null;
	weapon_conflict: boolean;
}

/**
 * Shape of a raw eBay item summary as it appears in `data.itemSummaries`.
 * Mirrors the Browse API's actual response — anything we don't denormalize
 * into a column gets dropped (the schema reserves `raw_payload` JSONB for
 * future debugging if we ever need to capture more).
 */
export interface RawEbayListing {
	itemId?: string;
	title?: string;
	image?: { imageUrl?: string };
	thumbnailImages?: Array<{ imageUrl?: string }>;
	price?: { value?: string; currency?: string };
	currentBidPrice?: { value?: string; currency?: string };
	bidCount?: number;
	buyingOptions?: string[];
	condition?: string;
	conditionId?: string;
	seller?: {
		username?: string;
		feedbackPercentage?: string;
		feedbackScore?: number;
	};
	itemCreationDate?: string;
	itemEndDate?: string;
	itemWebUrl?: string;
	itemAffiliateWebUrl?: string;
	categoryPath?: string;
	priorityListing?: boolean;
	marketingPrice?: {
		originalPrice?: { value?: string };
	};
}

export interface ListingObservationCard {
	id: string;
	game_id?: string | null;
	parallel?: string | null;
}

export interface ListingObservationInput {
	item: RawEbayListing;
	decision: ListingObservationDecision;
}

function parseFloatOrNull(value: string | undefined | null): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Persist per-listing observations + dedupe image rows for one card's
 * harvest result. Best-effort — any error is logged and swallowed so the
 * caller's harvester loop is never disrupted. Caller is expected to wrap
 * this in its own try/catch as a belt-and-braces guard.
 */
export async function persistObservations(
	admin: SupabaseClient<Database>,
	card: ListingObservationCard,
	runId: string,
	listings: ListingObservationInput[]
): Promise<void> {
	if (!listings || listings.length === 0) return;

	const observedAt = new Date().toISOString();
	const gameId = card.game_id ?? 'boba';
	const parallel = card.parallel ?? null;

	// Build observation rows from the listings whose itemId is known. Anything
	// missing an itemId is a malformed eBay response and not worth persisting
	// (and would violate the NOT NULL constraint).
	const observationRows = listings
		.filter((l) => typeof l.item.itemId === 'string' && (l.item.title ?? '').length > 0)
		.map(({ item, decision }) => ({
			observed_at: observedAt,
			run_id: runId,
			card_id: card.id,
			game_id: gameId,
			parallel,
			ebay_item_id: item.itemId as string,
			title: item.title as string,
			price_value: parseFloatOrNull(item.price?.value),
			price_currency: item.price?.currency ?? null,
			bid_count: typeof item.bidCount === 'number' ? item.bidCount : null,
			current_bid_value: parseFloatOrNull(item.currentBidPrice?.value),
			buying_options: item.buyingOptions ?? null,
			condition_label: item.condition ?? null,
			condition_id: item.conditionId ?? null,
			seller_username: item.seller?.username ?? null,
			seller_feedback_pct: parseFloatOrNull(item.seller?.feedbackPercentage),
			seller_feedback_score:
				typeof item.seller?.feedbackScore === 'number' ? item.seller.feedbackScore : null,
			category_path: item.categoryPath ?? null,
			item_created_at: item.itemCreationDate ?? null,
			item_ends_at: item.itemEndDate ?? null,
			priority_listing:
				typeof item.priorityListing === 'boolean' ? item.priorityListing : null,
			marketing_original_value: parseFloatOrNull(item.marketingPrice?.originalPrice?.value),
			image_url: item.image?.imageUrl ?? null,
			item_web_url: item.itemWebUrl ?? null,
			item_affiliate_url: item.itemAffiliateWebUrl ?? null,
			accepted_by_filter: decision.accepted,
			rejection_reason: decision.rejection_reason,
			weapon_conflict: decision.weapon_conflict ?? false,
			raw_payload: null
		}));

	if (observationRows.length > 0) {
		try {
			const { error: obsErr } = await (
				admin.from('ebay_listing_observations') as unknown as {
					insert: (rows: unknown[]) => Promise<{ error: { message: string } | null }>;
				}
			).insert(observationRows);
			if (obsErr) {
				console.error('[harvest:observations] insert failed:', obsErr.message);
			}
		} catch (err) {
			console.error(
				'[harvest:observations] insert threw:',
				err instanceof Error ? err.message : err
			);
		}
	}

	// Image dedupe rows — only listings with both itemId and image URL.
	const imageRows = listings
		.filter(
			(l) =>
				typeof l.item.itemId === 'string' &&
				typeof l.item.image?.imageUrl === 'string' &&
				(l.item.image.imageUrl ?? '').length > 0
		)
		.map(({ item }) => ({
			card_id: card.id,
			ebay_item_id: item.itemId as string,
			image_url: item.image!.imageUrl as string,
			thumbnail_url: item.thumbnailImages?.[0]?.imageUrl ?? null,
			last_seen_at: observedAt,
			last_title: item.title ?? null,
			parallel,
			is_active: true
		}));

	if (imageRows.length > 0) {
		try {
			const { error: imgErr } = await (
				admin.from('ebay_card_images') as unknown as {
					upsert: (
						rows: unknown[],
						opts: { onConflict: string; ignoreDuplicates?: boolean }
					) => Promise<{ error: { message: string } | null }>;
				}
			).upsert(imageRows, { onConflict: 'card_id,ebay_item_id', ignoreDuplicates: false });
			if (imgErr) {
				console.error('[harvest:images] upsert failed:', imgErr.message);
			}
		} catch (err) {
			console.error(
				'[harvest:images] upsert threw:',
				err instanceof Error ? err.message : err
			);
		}
	}
}
