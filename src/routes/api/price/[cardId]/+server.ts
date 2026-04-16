/**
 * GET /api/price/[cardId] — eBay price lookup with caching
 *
 * Checks Supabase price_cache first (1-hour TTL).
 * If stale: calls eBay Browse API → updates cache → returns.
 *
 * Cache headers enable Vercel edge caching (s-maxage).
 */

import { json, error } from '@sveltejs/kit';
import { isEbayConfigured, ebayFetch } from '$lib/server/ebay-auth';
import { checkEbayDailyLimit } from '$lib/server/redis';
import { checkAnonPriceRateLimit } from '$lib/server/rate-limit';
import { getAdminClient } from '$lib/server/supabase-admin';
import { calculatePriceStats } from '$lib/utils/pricing';

export const config = { maxDuration: 60 };
import { buildEbaySearchQuery, filterRelevantListings } from '$lib/server/ebay-query';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals, getClientAddress }) => {
	const { cardId } = params;

	// Validate cardId format (UUID or alphanumeric identifier)
	if (!cardId || !/^[\w-]{1,64}$/.test(cardId)) {
		throw error(400, 'Invalid card ID');
	}

	// Phase 2.5: price is keyed by (card_id, source, variant). Default to
	// 'paper' for backward compat — existing callers that don't pass a
	// variant get the Paper price (which is the only variant we have today
	// for all existing rows).
	const ALLOWED_VARIANTS = new Set(['paper', 'cf', 'ff', 'ocm', 'sf']);
	const rawVariant = (url.searchParams.get('variant') || 'paper').toLowerCase();
	const variant = ALLOWED_VARIANTS.has(rawVariant) ? rawVariant : 'paper';

	// Play cards use TEXT IDs (e.g., A---PL-1); hero cards use UUIDs.
	// Detect early so we route to the correct cache table before the card lookup.
	const isPlayCard = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId);

	if (!isEbayConfigured()) {
		return json({ error: 'eBay pricing not available' }, { status: 503 });
	}

	// Check auth (optional — prices can be public)
	const { user } = await locals.safeGetSession();

	// Rate limit anonymous price lookups to prevent eBay API abuse
	if (!user) {
		const rateLimit = await checkAnonPriceRateLimit(getClientAddress());
		if (!rateLimit.success) {
			return json(
				{ error: 'Rate limited. Please sign in for unlimited price lookups.' },
				{
					status: 429,
					headers: {
						'X-RateLimit-Limit': String(rateLimit.limit),
						'X-RateLimit-Remaining': String(rateLimit.remaining),
						'X-RateLimit-Reset': String(rateLimit.reset)
					}
				}
			);
		}
	}

	if (!locals.supabase) {
		return json({ error: 'Database not available' }, { status: 503 });
	}

	// Check price cache (4-hour freshness) — use service role to bypass RLS.
	// Play cards use play_price_cache (TEXT key); heroes use price_cache (UUID key).
	// Phase 2.5: price_cache is keyed by (card_id, source, variant).
	const cacheTable = isPlayCard ? 'play_price_cache' : 'price_cache';
	const cacheClient = getAdminClient() || locals.supabase;
	let cacheQuery = cacheClient
		.from(cacheTable)
		.select('*')
		.eq('card_id', cardId)
		.eq('source', 'ebay');
	// play_price_cache doesn't have a variant column (play cards are always 'paper');
	// only filter by variant on the hero cards table.
	if (!isPlayCard) {
		cacheQuery = (cacheQuery as unknown as { eq: (c: string, v: string) => typeof cacheQuery }).eq('variant', variant);
	}
	const { data: cachedRaw } = await cacheQuery.single();

	const cached = cachedRaw as { card_id: string; source: string; price_low: number | null; price_mid: number | null; price_high: number | null; listings_count: number | null; fetched_at: string } | null;

	if (cached) {
		const age = Date.now() - new Date(cached.fetched_at).getTime();
		if (age < 14400_000) { // 4-hour TTL — BoBA card prices don't move hourly
			return json(cached, {
				headers: {
					'Cache-Control': 's-maxage=14400, stale-while-revalidate=28800'
				}
			});
		}
	}

	// Get card details for search query — check hero cards first, fall back to play cards
	let card: { name: string | null; hero_name: string | null; athlete_name: string | null; card_number: string | null; set_code: string | null; parallel: string | null; weapon_type: string | null } | null = null;

	const { data: heroCard } = await locals.supabase
		.from('cards')
		.select('name, hero_name, athlete_name, card_number, set_code, parallel, weapon_type')
		.eq('id', cardId)
		.maybeSingle();

	if (heroCard) {
		card = heroCard;
	} else {
		// Fall back to play_cards table (play cards, bonus plays, hot dogs)
		const { data: playCard } = await locals.supabase
			.from('play_cards')
			.select('name, card_number, release')
			.eq('id', cardId)
			.maybeSingle();

		if (playCard) {
			card = {
				name: playCard.name,
				hero_name: null,
				athlete_name: null,
				card_number: playCard.card_number,
				set_code: playCard.release || null,
				parallel: null,
				weapon_type: null
			};
		}
	}

	if (!card) {
		throw error(404, 'Card not found');
	}

	const query = buildEbaySearchQuery(card);

	// Check eBay daily API call limit (4,500/day with 500 headroom)
	const withinLimit = await checkEbayDailyLimit();
	if (!withinLimit) {
		if (cached) return json(cached, { headers: { 'Cache-Control': 's-maxage=60' } });
		return json({ error: 'Price lookups temporarily limited' }, { status: 503 });
	}

	try {
		const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
		searchUrl.searchParams.set('q', query);
		searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
		searchUrl.searchParams.set('limit', '50');

		// ebayFetch handles token acquisition and automatic retry on 401
		const browseRes = await ebayFetch(searchUrl.toString());

		if (!browseRes.ok) {
			throw error(502, 'eBay API error');
		}

		const data = await browseRes.json();
		const rawItems: Array<{ title?: string; price?: { value?: string }; buyingOptions?: string[] }> = data.itemSummaries || [];

		// Filter to listings that actually match this card using tiered priority
		const items = filterRelevantListings(rawItems, card);

		// Separate fixed price from auction
		const fixedPriceItems = items.filter((item: { buyingOptions?: string[] }) =>
			item.buyingOptions?.includes('FIXED_PRICE')
		);

		const allPrices = items
			.map((item: { price?: { value?: string } }) => parseFloat(item.price?.value || '0'))
			.filter((p: number) => p > 0);

		const fixedPrices = fixedPriceItems
			.map((item: { price?: { value?: string } }) => parseFloat(item.price?.value || '0'))
			.filter((p: number) => p > 0);

		const allStats = calculatePriceStats(allPrices);
		const fixedStats = calculatePriceStats(fixedPrices);

		// Phase 2.5: include variant on hero price_cache rows. Play cards are
		// always paper — their cache table doesn't have a variant column.
		const priceData: Record<string, unknown> = {
			card_id: cardId,
			source: 'ebay',
			price_low: allStats?.low ?? null,
			price_mid: allStats?.median ?? null,
			price_high: allStats?.high ?? null,
			listings_count: allPrices.length,
			buy_now_low: fixedStats?.low ?? null,
			buy_now_mid: fixedStats?.median ?? null,
			buy_now_count: fixedPrices.length,
			filtered_count: allStats?.filteredCount ?? allPrices.length,
			confidence_score: allStats?.confidenceScore ?? 0,
			fetched_at: new Date().toISOString()
		};
		if (!isPlayCard) priceData.variant = variant;

		// Update cache — use service role to bypass RLS.
		// Play cards → play_price_cache (TEXT key), heroes → price_cache (UUID key).
		// Hero price_cache PK is now (card_id, source, variant).
		try {
			const adminClient = getAdminClient();
			if (!adminClient) throw new Error('Admin client unavailable for cache write');
			const onConflictKey = isPlayCard ? 'card_id,source' : 'card_id,source,variant';
			// Cast through unknown: generated types are stale (no `variant` column yet).
			const { error: cacheError } = await (adminClient.from(cacheTable) as unknown as {
				upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
			}).upsert(priceData, { onConflict: onConflictKey });
			if (cacheError) {
				console.error('[api/price] price_cache upsert FAILED:', cacheError.message);
			}
		} catch (err) {
			console.error('[api/price] Cache write exception:', err);
		}

		// Log price data point to history — only when price actually changed.
		// Play cards → play_price_history, heroes → price_history.
		const historyTable = isPlayCard ? 'play_price_history' : 'price_history';
		try {
			const historyClient = getAdminClient();
			if (!historyClient) throw new Error('Admin client unavailable for history write');
			const { data: lastEntry } = await historyClient
				.from(historyTable)
				.select('price_mid')
				.eq('card_id', cardId)
				.order('recorded_at', { ascending: false })
				.limit(1)
				.maybeSingle();

			const priceChanged = !lastEntry || lastEntry.price_mid !== (priceData.price_mid as number | null);
			if (priceChanged) {
				// Cast through unknown for the insert — priceData is Record<string, unknown>
				// to carry variant, and the generated Supabase types don't know about it yet.
				const historyRow: Record<string, unknown> = {
					card_id: cardId,
					source: 'ebay',
					price_low: priceData.price_low,
					price_mid: priceData.price_mid,
					price_high: priceData.price_high,
					listings_count: priceData.listings_count,
					recorded_at: new Date().toISOString()
				};
				if (!isPlayCard) historyRow.variant = variant;
				const { error: historyError } = await (historyClient.from(historyTable) as unknown as {
					insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
				}).insert(historyRow);
				if (historyError) {
					console.error('[api/price] price_history insert FAILED:', historyError.message);
				}
			}
		} catch (err) {
			console.error('[api/price] Price history exception:', err);
		}

		return json(priceData, {
			headers: {
				'Cache-Control': 's-maxage=14400, stale-while-revalidate=28800'
			}
		});
	} catch (err) {
		// Return stale cached data if available
		if (cached) {
			return json(cached, {
				headers: { 'Cache-Control': 's-maxage=60' }
			});
		}
		throw error(502, 'Price lookup failed');
	}
};
