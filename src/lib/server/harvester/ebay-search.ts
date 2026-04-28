/**
 * Single source of truth for "search eBay, evaluate listings, return
 * accepted items + decisions". Used by both refreshCardPrice (hero/wonder
 * cards in price_cache) and refreshPlayCardPrice (play cards in
 * play_price_cache).
 *
 * Returns ALL decisions (accepted + rejected) so callers can persist
 * observations; returns the accepted subset as `items` for the price math.
 *
 * Refunds the eBay-call counter on 429 (no quota consumed) and on thrown
 * errors (request never reached eBay). See refundEbayCall comment for why
 * this matters — counter drift trips our self-imposed 4500-call cap early.
 */

import { ebayFetch } from '$lib/server/ebay-auth';
import { buildEbaySearchQuery, evaluateListings } from '$lib/server/ebay-query';
import {
	buildWondersEbayQuery,
	evaluateWondersListings,
	scoreWondersListingMatch,
} from '$lib/server/ebay-query-wonders';
import type { RawEbayListing } from '$lib/server/harvester/listing-observations';
import type { getRedis } from '$lib/server/redis';
import type { CardCandidate } from './candidates';

type RedisClient = NonNullable<ReturnType<typeof getRedis>>;

type BobaDecisions = ReturnType<typeof evaluateListings<RawEbayListing>>;
type WondersDecisions = ReturnType<typeof evaluateWondersListings<RawEbayListing>>;

export interface SearchOutcome {
	ok: boolean;
	httpStatus?: number;
	errorMessage?: string;
	query: string;
	rawCount: number;
	items: RawEbayListing[];
	decisions: BobaDecisions | WondersDecisions;
	/** Wonders title-match score, averaged across accepted items. Null for BoBA. */
	wondersAvgTitleScore: number | null;
}

export async function refundEbayCall(
	redis: RedisClient,
	today: string,
	reason: string,
	cardId?: string
): Promise<void> {
	try {
		const key = `ebay-calls:${today}`;
		const count = await redis.decr(key);
		if (count < 0) await redis.set(key, 0, { ex: 86400 });
		console.debug(`[harvest] Refunded ebay-calls counter (${reason}) card=${cardId ?? 'n/a'} new_count=${Math.max(0, count)}`);
	} catch (err) {
		console.debug('[harvest] Counter refund failed:', err instanceof Error ? err.message : err);
	}
}

export async function searchAndEvaluate(
	card: CardCandidate,
	parallel: string,
	redis: RedisClient,
	today: string
): Promise<SearchOutcome> {
	const gameId = (card.game_id || 'boba').toLowerCase();
	const isWonders = gameId === 'wonders';
	const wondersCardInfo = {
		hero_name: card.hero_name,
		name: card.name,
		card_number: card.card_number,
		parallel,
		game_id: 'wonders' as const,
		metadata: card.metadata ?? null,
	};
	const query = isWonders ? buildWondersEbayQuery(wondersCardInfo) : buildEbaySearchQuery(card);

	// Increment Redis counter BEFORE the call
	try {
		const key = `ebay-calls:${today}`;
		const count = await redis.incr(key);
		if (count === 1) await redis.expire(key, 86400);
	} catch (err) {
		console.debug('[harvest] Redis counter increment failed:', err instanceof Error ? err.message : err);
	}

	try {
		const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
		searchUrl.searchParams.set('q', query);
		searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
		searchUrl.searchParams.set('limit', '50');

		const res = await ebayFetch(searchUrl.toString());
		if (!res.ok) {
			if (res.status === 429) {
				await refundEbayCall(redis, today, '429 response', card.id);
			}
			return {
				ok: false,
				httpStatus: res.status,
				errorMessage: `eBay API returned ${res.status}`,
				query,
				rawCount: 0,
				items: [],
				decisions: [],
				wondersAvgTitleScore: null,
			};
		}

		const data = await res.json();
		const rawItems: RawEbayListing[] = data.itemSummaries || [];
		const decisions = isWonders
			? evaluateWondersListings(rawItems, wondersCardInfo)
			: evaluateListings(rawItems, card);
		const items = decisions
			.filter((d) => d.decision.accepted)
			.map((d) => d.item);

		let wondersAvgTitleScore: number | null = null;
		if (isWonders && items.length > 0) {
			const titleScores = items.map((it) => scoreWondersListingMatch(it.title || '', wondersCardInfo));
			wondersAvgTitleScore =
				titleScores.reduce((a, b) => a + b, 0) / titleScores.length;
		}

		return {
			ok: true,
			httpStatus: res.status,
			query,
			rawCount: rawItems.length,
			items,
			decisions,
			wondersAvgTitleScore,
		};
	} catch (err) {
		await refundEbayCall(redis, today, 'fetch threw', card.id);
		return {
			ok: false,
			errorMessage: err instanceof Error ? err.message : 'Unknown error',
			query,
			rawCount: 0,
			items: [],
			decisions: [],
			wondersAvgTitleScore: null,
		};
	}
}
