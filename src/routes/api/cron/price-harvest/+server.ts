/**
 * GET /api/cron/price-harvest — Self-chaining eBay price harvester
 *
 * Triggered by Vercel Cron at 04:45 UTC (11:45 PM EST). Processes a batch of cards,
 * then fires a fetch() to itself to continue. Repeats until eBay
 * quota is exhausted or the harvest window closes.
 *
 * Auth: CRON_SECRET header (Vercel Cron provides this automatically).
 * Self-chain links forward the same auth header.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isEbayConfigured, ebayFetch } from '$lib/server/ebay-auth';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { Database } from '$lib/types/database';
import { getRedis, getHarvestConfidenceThreshold } from '$lib/server/redis';
import { calculatePriceStats } from '$lib/utils/pricing';
import { buildEbaySearchQuery, filterRelevantListings } from '$lib/server/ebay-query';
import type { RequestHandler } from './$types';

// Vercel Hobby supports up to 60s
export const config = { maxDuration: 60 };

const CARDS_PER_RUN = 25;       // Max cards per invocation (time-check is the real limiter)
const CARD_DELAY_MS = 2000;     // 2s between eBay calls — stays under burst limit
const MAX_CHAIN_DEPTH = 1500;   // Safety cap (~33K cards max across all chains)
const RESERVE_CALLS = 0;        // Harvester gets 100% of budget

export const GET: RequestHandler = async ({ request, url }) => {
	// ── Auth ─────────────────────────────────────────────
	const authHeader = request.headers.get('authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		throw error(401, 'Unauthorized');
	}

	if (!isEbayConfigured()) {
		return json({ skipped: true, reason: 'eBay not configured' });
	}

	const admin = getAdminClient();
	if (!admin) {
		return json({ skipped: true, reason: 'Admin client unavailable' });
	}

	// ── Chain depth tracking ─────────────────────────────
	const chainDepth = parseInt(request.headers.get('x-harvest-chain-depth') || '0', 10);
	if (chainDepth >= MAX_CHAIN_DEPTH) {
		return json({ stopped: true, reason: 'Max chain depth reached', depth: chainDepth });
	}

	// ── Check remaining eBay quota ───────────────────────
	const redis = getRedis();
	if (!redis) {
		return json({ skipped: true, reason: 'Redis unavailable' });
	}

	const today = new Date().toISOString().slice(0, 10);
	const confidenceThreshold = await getHarvestConfidenceThreshold();
	let usedToday = 0;
	try {
		const count = await redis.get<number>(`ebay-calls:${today}`);
		usedToday = count ?? 0;
	} catch {
		return json({ skipped: true, reason: 'Redis read failed' });
	}

	const remainingCalls = 5000 - usedToday - RESERVE_CALLS;
	if (remainingCalls <= 0) {
		await logHarvestComplete(admin, usedToday, chainDepth, 'quota_exhausted');
		return json({
			stopped: true,
			reason: 'Quota exhausted',
			used: usedToday,
			depth: chainDepth
		});
	}

	const callBudget = Math.min(remainingCalls, CARDS_PER_RUN);

	// (offset tracking removed — candidate selection uses price_harvest_log
	// to skip already-processed cards, so no offset needed)

	// ── Fetch prioritized card list ─────────────────────
	const candidates = await getNextCandidates(admin, callBudget, today);
	if (candidates.length === 0) {
		await logHarvestComplete(admin, usedToday, chainDepth, 'no_cards_remaining');
		return json({
			stopped: true,
			reason: 'No more cards to refresh',
			used: usedToday,
			depth: chainDepth
		});
	}

	// ── Process cards sequentially with 2s spacing ──────
	const startTime = Date.now();
	let processed = 0;
	let updated = 0;
	let errors = 0;
	let consecutive429s = 0;
	const harvestLogs: Record<string, unknown>[] = [];

	for (let i = 0; i < candidates.length; i++) {
		// Stop 8s before timeout to leave room for logging + chain fire
		if (Date.now() - startTime > 52000) break;

		// If eBay is actively throttling us, stop this link.
		// The chain continues — next link will try fresh after a brief gap.
		if (consecutive429s >= 3) {
			console.warn('[harvest] 3 consecutive 429s — stopping this link');
			break;
		}

		const card = candidates[i];

		try {
			const result = await refreshCardPrice(admin, card, redis, today, chainDepth, confidenceThreshold);
			processed++;

			if (result.success) {
				updated++;
				consecutive429s = 0;
			}

			if (result.logEntry) {
				harvestLogs.push(result.logEntry);
				// Track 429s from the error message
				const errMsg = String(result.logEntry.error_message || '');
				if (errMsg.includes('429')) {
					consecutive429s++;
				} else if (result.success) {
					consecutive429s = 0;
				}
			}
		} catch (err) {
			console.error(`[harvest] Card ${card.id} (${card.card_number}) threw unexpectedly:`, err instanceof Error ? err.message : err);
			processed++;
			errors++;
		}

		// 2s delay between cards (skip after last one)
		if (i < candidates.length - 1) {
			await new Promise(r => setTimeout(r, CARD_DELAY_MS));
		}
	}

	// ── Batch insert harvest logs ────────────────────────
	if (harvestLogs.length > 0) {
		try {
			await admin.from('price_harvest_log').insert(harvestLogs as unknown as Database['public']['Tables']['price_harvest_log']['Insert'][]);
		} catch (err) {
			console.error('[harvest] Log batch insert failed:', err instanceof Error ? err.message : err);
		}
	}

	// (offset tracking removed — no longer needed)

	// ── Fire next chain link ─────────────────────────────
	// Skip self-chaining when triggered manually (browser handles the loop)
	const noChain = request.headers.get('x-harvest-no-chain') === 'true';
	if (!noChain) {
		// If we hit 429s, wait 30s before chaining to let eBay's burst window reset.
		// Combined with the next link's own processing time, this creates a ~90s gap
		// between the last failed call and the next attempt.
		if (consecutive429s > 0) {
			await new Promise(r => setTimeout(r, 30000));
		}

		const selfUrl = `${url.origin}/api/cron/price-harvest`;
		try {
			fetch(selfUrl, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${cronSecret}`,
					'X-Harvest-Chain-Depth': String(chainDepth + 1)
				}
			}).catch((err) => {
				console.warn('[harvest] Chain link fetch failed — next cron trigger will resume:', err instanceof Error ? err.message : err);
			});
		} catch (err) {
			console.warn('[harvest] fetch() constructor failed — chain ends here:', err instanceof Error ? err.message : err);
		}
	}

	// ── Log quota snapshot to ebay_api_log ────────────────
	let currentUsed = usedToday;
	try {
		const count = await redis.get<number>(`ebay-calls:${today}`);
		currentUsed = count ?? usedToday;
	} catch (err) { console.debug('[harvest] Post-batch Redis read failed, using pre-batch count:', err instanceof Error ? err.message : err); }

	try {
		await admin.from('ebay_api_log').insert({
			calls_used: currentUsed,
			calls_remaining: Math.max(0, 5000 - currentUsed),
			calls_limit: 5000,
			reset_at: getNextResetTime(),
			chain_depth: chainDepth,
			cards_processed: processed,
			cards_updated: updated,
			cards_errored: errors,
			status: consecutive429s >= 3 ? 'rate_limited' : 'running',
			recorded_at: new Date().toISOString()
		});
	} catch (err) { console.warn('[harvest] ebay_api_log insert failed:', err instanceof Error ? err.message : err); }

	return json({
		success: true,
		depth: chainDepth,
		processed,
		updated,
		errors,
		rateLimited: consecutive429s >= 3,
		remainingBefore: remainingCalls,
		durationMs: Date.now() - startTime
	});
};

// ── SQL-based candidate selection ───────────────────────────
// Single Postgres function replaces four in-memory priority passes.
// Avoids the Supabase JS client's 1,000-row default limit that
// caused the harvester to stall after ~1,000 cards.

interface CardCandidate {
	id: string;
	hero_name: string | null;
	name: string | null;
	card_number: string | null;
	athlete_name: string | null;
	priority: number;
}

async function getNextCandidates(
	admin: NonNullable<ReturnType<typeof getAdminClient>>,
	limit: number,
	today: string
): Promise<CardCandidate[]> {
	const { data, error: rpcError } = await admin.rpc('get_harvest_candidates', {
		p_run_id: today,
		p_limit: limit
	});

	if (rpcError) {
		console.error('[harvest] get_harvest_candidates RPC failed:', rpcError);
		return [];
	}

	return (data as unknown as CardCandidate[]) || [];
}

// ── Single card price refresh ───────────────────────────────

interface RefreshResult {
	success: boolean;
	logEntry: Record<string, unknown> | null;
}

async function refreshCardPrice(
	admin: NonNullable<ReturnType<typeof getAdminClient>>,
	card: CardCandidate,
	redis: NonNullable<ReturnType<typeof getRedis>>,
	today: string,
	chainDepth: number,
	confidenceThreshold: number
): Promise<RefreshResult> {
	const query = buildEbaySearchQuery(card);
	const callStart = Date.now();

	// Increment Redis counter BEFORE the call
	try {
		const key = `ebay-calls:${today}`;
		const count = await redis.incr(key);
		if (count === 1) await redis.expire(key, 86400);
	} catch (err) { console.debug('[harvest] Redis counter increment failed:', err instanceof Error ? err.message : err); }

	// Fetch previous price for delta tracking
	let previousMid: number | null = null;
	let isNewPrice = false;
	try {
		const { data: cached } = await admin
			.from('price_cache')
			.select('price_mid')
			.eq('card_id', card.id)
			.eq('source', 'ebay')
			.maybeSingle();

		if (cached) {
			previousMid = cached.price_mid !== null ? Number(cached.price_mid) : null;
		} else {
			isNewPrice = true;
		}
	} catch (err) { console.debug('[harvest] Previous price fetch failed (delta tracking):', err instanceof Error ? err.message : err); }

	try {
		const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
		searchUrl.searchParams.set('q', query);
		searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
		searchUrl.searchParams.set('limit', '50');

		const res = await ebayFetch(searchUrl.toString());
		if (!res.ok) {
			return {
				success: false,
				logEntry: buildLogEntry(card, query, chainDepth, today, callStart, {
					success: false,
					error_message: `eBay API returned ${res.status}`,
					isNewPrice, previousMid
				})
			};
		}

		const data = await res.json();
		const rawItems: Array<{
			title?: string;
			price?: { value?: string };
			buyingOptions?: string[];
		}> = data.itemSummaries || [];

		const ebayResultsRaw = rawItems.length;

		// Filter to listings that actually match this card
		const items = filterRelevantListings(rawItems, card);

		// Separate by buying option
		const fixedPriceItems = items.filter(item =>
			item.buyingOptions?.includes('FIXED_PRICE')
		);
		const auctionItems = items.filter(item =>
			item.buyingOptions?.includes('AUCTION')
		);

		const allPrices = items
			.map(item => parseFloat(item.price?.value || '0'))
			.filter(p => p > 0);

		const fixedPrices = fixedPriceItems
			.map(item => parseFloat(item.price?.value || '0'))
			.filter(p => p > 0);

		const allStats = calculatePriceStats(allPrices);
		const fixedStats = calculatePriceStats(fixedPrices);

		const priceData = {
			card_id: card.id,
			source: 'ebay',
			price_low: allStats?.low ?? null,
			price_mid: allStats?.median ?? null,
			price_high: allStats?.high ?? null,
			listings_count: allPrices.length,
			buy_now_low: fixedStats?.low ?? null,
			buy_now_mid: fixedStats?.median ?? null,
			buy_now_count: fixedPrices.length,
			filtered_count: allStats?.filteredCount ?? 0,
			confidence_score: allStats?.confidenceScore ?? 0,
			fetched_at: new Date().toISOString()
		};

		// Check confidence threshold before accepting price
		const meetsThreshold = (allStats?.confidenceScore ?? 0) >= confidenceThreshold;

		// Always upsert price_cache so the card is marked as "searched".
		// Cards below threshold get cached with null prices (searched, no price)
		// so they drop to stale priority instead of being re-searched as "unpriced".
		const cachePayload = meetsThreshold
			? priceData
			: {
				...priceData,
				// Zero out prices so it's clearly "searched, none found"
				price_low: null,
				price_mid: null,
				price_high: null,
				buy_now_low: null,
				buy_now_mid: null,
			};
		const { error: cacheError } = await admin.from('price_cache').upsert(cachePayload, { onConflict: 'card_id,source' });
		if (cacheError) {
			console.error(`[harvest] price_cache upsert FAILED for ${card.id}:`, cacheError.message);
		}

		// Write price history only if price changed AND meets threshold
		const newMid = priceData.price_mid !== null ? Number(priceData.price_mid) : null;
		const priceChanged = previousMid !== newMid;

		if (meetsThreshold && (!previousMid || priceChanged)) {
			const { error: historyError } = await admin.from('price_history').insert({
				card_id: card.id,
				source: 'ebay',
				price_low: priceData.price_low,
				price_mid: priceData.price_mid,
				price_high: priceData.price_high,
				listings_count: priceData.listings_count,
				recorded_at: new Date().toISOString()
			});
			if (historyError) {
				console.error(`[harvest] price_history insert FAILED for ${card.id}:`, historyError.message);
			}
		}

		// Calculate delta
		let priceDelta: number | null = null;
		let priceDeltaPct: number | null = null;
		if (previousMid !== null && newMid !== null) {
			priceDelta = parseFloat((newMid - previousMid).toFixed(2));
			if (previousMid > 0) {
				priceDeltaPct = parseFloat(((priceDelta / previousMid) * 100).toFixed(2));
			}
		}

		return {
			success: true,
			logEntry: {
				run_id: today,
				chain_depth: chainDepth,
				priority: card.priority,
				card_id: card.id,
				hero_name: card.hero_name,
				card_name: card.name,
				card_number: card.card_number,
				search_query: query,
				ebay_results_raw: ebayResultsRaw,
				auction_count: auctionItems.length,
				fixed_price_count: fixedPriceItems.length,
				price_low: allStats?.low ?? null,
				price_mid: allStats?.median ?? null,
				price_high: allStats?.high ?? null,
				price_mean: allStats?.mean ?? null,
				listings_count: allPrices.length,
				filtered_count: allStats?.filteredCount ?? 0,
				confidence_score: allStats?.confidenceScore ?? 0,
				buy_now_low: fixedStats?.low ?? null,
				buy_now_mid: fixedStats?.median ?? null,
				buy_now_high: fixedStats?.high ?? null,
				buy_now_mean: fixedStats?.mean ?? null,
				buy_now_count: fixedPrices.length,
				buy_now_filtered: fixedStats?.filteredCount ?? 0,
				buy_now_confidence: fixedStats?.confidenceScore ?? 0,
				previous_mid: previousMid,
				price_changed: priceChanged,
				price_delta: priceDelta,
				price_delta_pct: priceDeltaPct,
				is_new_price: isNewPrice,
				success: true,
				zero_results: ebayResultsRaw === 0,
				threshold_rejected: !meetsThreshold,
				error_message: null,
				duration_ms: Date.now() - callStart,
				processed_at: new Date().toISOString()
			}
		};
	} catch (err) {
		return {
			success: false,
			logEntry: buildLogEntry(card, query, chainDepth, today, callStart, {
				success: false,
				error_message: err instanceof Error ? err.message : 'Unknown error',
				isNewPrice, previousMid
			})
		};
	}
}

/**
 * Build a minimal log entry for failed refreshes.
 */
function buildLogEntry(
	card: CardCandidate,
	query: string,
	chainDepth: number,
	today: string,
	callStart: number,
	result: { success: boolean; error_message: string | null; isNewPrice: boolean; previousMid: number | null }
): Record<string, unknown> {
	return {
		run_id: today,
		chain_depth: chainDepth,
		priority: card.priority,
		card_id: card.id,
		hero_name: card.hero_name,
		card_name: card.name,
		card_number: card.card_number,
		search_query: query,
		ebay_results_raw: 0,
		auction_count: 0,
		fixed_price_count: 0,
		price_low: null,
		price_mid: null,
		price_high: null,
		price_mean: null,
		listings_count: 0,
		filtered_count: 0,
		confidence_score: 0,
		buy_now_low: null,
		buy_now_mid: null,
		buy_now_high: null,
		buy_now_mean: null,
		buy_now_count: 0,
		buy_now_filtered: 0,
		buy_now_confidence: 0,
		previous_mid: result.previousMid,
		price_changed: false,
		price_delta: null,
		price_delta_pct: null,
		is_new_price: result.isNewPrice,
		success: result.success,
		zero_results: true,
		error_message: result.error_message,
		duration_ms: Date.now() - callStart,
		processed_at: new Date().toISOString()
	};
}

// ── Helpers ─────────────────────────────────────────────────

async function logHarvestComplete(
	admin: NonNullable<ReturnType<typeof getAdminClient>>,
	usedToday: number,
	chainDepth: number,
	reason: string
): Promise<void> {
	try {
		await admin.from('ebay_api_log').insert({
			calls_used: usedToday,
			calls_remaining: Math.max(0, 5000 - usedToday),
			calls_limit: 5000,
			reset_at: getNextResetTime(),
			chain_depth: chainDepth,
			cards_processed: 0,
			cards_updated: 0,
			cards_errored: 0,
			status: reason,
			recorded_at: new Date().toISOString()
		});
	} catch (err) { console.warn('[harvest] Harvest-complete log insert failed:', err instanceof Error ? err.message : err); }
}

function getNextResetTime(): string {
	const tomorrow = new Date();
	tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
	tomorrow.setUTCHours(0, 0, 0, 0);
	return tomorrow.toISOString();
}
