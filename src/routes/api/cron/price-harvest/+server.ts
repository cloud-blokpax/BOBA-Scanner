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
import { getRedis, getHarvestConfidenceThreshold } from '$lib/server/redis';
import { calculatePriceStats } from '$lib/utils/pricing';
import { buildEbaySearchQuery, filterRelevantListings } from '$lib/server/ebay-query';
import type { RequestHandler } from './$types';

// Vercel Hobby = 10s max
export const config = { maxDuration: 10 };

const BATCH_SIZE = 3;       // Parallel calls per wave
const MAX_WAVES = 3;        // Sequential waves per invocation (3×3 = 9 cards)
const WAVE_DELAY_MS = 200;  // Stagger between waves
const MAX_CHAIN_DEPTH = 600; // Safety cap (~5,400 cards max)
const RESERVE_CALLS = 0;    // Harvester gets 100% of budget

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

	const callBudget = Math.min(remainingCalls, BATCH_SIZE * MAX_WAVES);

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

	// ── Process in waves ────────────────────────────────
	const startTime = Date.now();
	let processed = 0;
	let updated = 0;
	let errors = 0;
	const harvestLogs: Record<string, unknown>[] = [];

	for (let wave = 0; wave < MAX_WAVES; wave++) {
		if (Date.now() - startTime > 7500) break;

		const waveStart = wave * BATCH_SIZE;
		const waveCards = candidates.slice(waveStart, waveStart + BATCH_SIZE);
		if (waveCards.length === 0) break;

		const results = await Promise.allSettled(
			waveCards.map(card => refreshCardPrice(admin, card, redis, today, chainDepth, confidenceThreshold))
		);

		for (const result of results) {
			processed++;
			if (result.status === 'fulfilled') {
				if (result.value.success) updated++;
				if (result.value.logEntry) harvestLogs.push(result.value.logEntry);
			} else {
				errors++;
			}
		}

		if (wave < MAX_WAVES - 1 && waveCards.length === BATCH_SIZE) {
			await new Promise(r => setTimeout(r, WAVE_DELAY_MS));
		}
	}

	// ── Batch insert harvest logs ────────────────────────
	if (harvestLogs.length > 0) {
		try {
			await admin.from('price_harvest_log').insert(harvestLogs);
		} catch (err) {
			console.debug('[harvest] Log batch insert failed:', err);
		}
	}

	// (offset tracking removed — no longer needed)

	// ── Fire next chain link (non-blocking) ─────────────
	// Skip self-chaining when triggered manually (browser handles the loop)
	const noChain = request.headers.get('x-harvest-no-chain') === 'true';
	if (!noChain) {
		const selfUrl = `${url.origin}/api/cron/price-harvest`;
		try {
			fetch(selfUrl, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${cronSecret}`,
					'X-Harvest-Chain-Depth': String(chainDepth + 1)
				}
			}).catch(() => {
				// Chain break is OK — next cron trigger will resume
			});
		} catch {
			// fetch() itself failed — chain ends here
		}
	}

	// ── Log quota snapshot to ebay_api_log ────────────────
	let currentUsed = usedToday;
	try {
		const count = await redis.get<number>(`ebay-calls:${today}`);
		currentUsed = count ?? usedToday;
	} catch { /* use pre-batch count */ }

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
			status: 'running',
			recorded_at: new Date().toISOString()
		});
	} catch { /* non-critical */ }

	return json({
		success: true,
		depth: chainDepth,
		processed,
		updated,
		errors,
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

	return (data as CardCandidate[]) || [];
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
	} catch { /* best-effort */ }

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
	} catch { /* non-critical — delta tracking is best-effort */ }

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

		// Upsert price cache ONLY if confidence meets threshold
		if (meetsThreshold) {
			await admin.from('price_cache').upsert(priceData, { onConflict: 'card_id,source' });
		}

		// Write price history only if price changed AND meets threshold
		const newMid = priceData.price_mid !== null ? Number(priceData.price_mid) : null;
		const priceChanged = previousMid !== newMid;

		if (meetsThreshold && (!previousMid || priceChanged)) {
			await admin.from('price_history').insert({
				card_id: card.id,
				source: 'ebay',
				price_low: priceData.price_low,
				price_mid: priceData.price_mid,
				price_high: priceData.price_high,
				listings_count: priceData.listings_count,
				recorded_at: new Date().toISOString()
			});
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
	} catch { /* non-critical */ }
}

function getNextResetTime(): string {
	const tomorrow = new Date();
	tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
	tomorrow.setUTCHours(0, 0, 0, 0);
	return tomorrow.toISOString();
}
