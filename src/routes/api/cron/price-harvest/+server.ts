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

	// ── Get offset for this chain link ───────────────────
	const offsetKey = `harvest-offset:${today}`;
	let offset = 0;
	try {
		const stored = await redis.get<number>(offsetKey);
		offset = stored ?? 0;
	} catch { /* start from 0 */ }

	// ── Fetch prioritized card list ─────────────────────
	const candidates = await getPrioritizedCards(admin, callBudget, offset);
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

	// ── Update offset for next chain link ────────────────
	try {
		await redis.set(offsetKey, offset + processed, { ex: 86400 });
	} catch { /* best-effort */ }

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
		offset,
		nextOffset: offset + processed,
		remainingBefore: remainingCalls,
		durationMs: Date.now() - startTime
	});
};

// ── Prioritized card selection ──────────────────────────────

interface CardCandidate {
	id: string;
	hero_name: string | null;
	name: string | null;
	card_number: string | null;
	priority: number;
}

async function getPrioritizedCards(
	admin: NonNullable<ReturnType<typeof getAdminClient>>,
	limit: number,
	offset: number
): Promise<CardCandidate[]> {
	const candidates: CardCandidate[] = [];
	const seenIds = new Set<string>();

	// Step 1: Get all card_ids that already have prices
	const { data: pricedRows } = await admin
		.from('price_cache')
		.select('card_id, fetched_at')
		.eq('source', 'ebay');

	const pricedMap = new Map<string, string>();
	for (const row of pricedRows || []) {
		pricedMap.set(row.card_id, row.fetched_at);
	}

	// Step 2: Get all distinct card_ids in user collections
	const { data: collectionRows } = await admin
		.from('collections')
		.select('card_id');

	const collectedIds = new Set<string>();
	for (const row of collectionRows || []) {
		collectedIds.add(row.card_id);
	}

	// Priority 1: Cards in collections with NO price cache
	const unpricedCollected = [...collectedIds].filter(id => !pricedMap.has(id));
	for (const id of unpricedCollected) {
		if (!seenIds.has(id)) {
			candidates.push({ id, hero_name: null, name: null, card_number: null, priority: 1 });
			seenIds.add(id);
		}
	}

	// Priority 2: Cards in collections with STALE prices (oldest first)
	const staleThreshold24h = Date.now() - 24 * 60 * 60 * 1000;
	const staleCollected = [...collectedIds]
		.filter(id => {
			const fetched = pricedMap.get(id);
			return fetched && new Date(fetched).getTime() < staleThreshold24h && !seenIds.has(id);
		})
		.sort((a, b) => {
			return new Date(pricedMap.get(a)!).getTime() - new Date(pricedMap.get(b)!).getTime();
		});

	for (const id of staleCollected) {
		candidates.push({ id, hero_name: null, name: null, card_number: null, priority: 2 });
		seenIds.add(id);
	}

	// Priority 3: Any card with no price data
	try {
		const { data: allCards } = await admin
			.from('cards')
			.select('id')
			.order('id')
			.range(0, 5000);

		if (allCards) {
			for (const card of allCards) {
				if (!seenIds.has(card.id) && !pricedMap.has(card.id)) {
					candidates.push({ id: card.id, hero_name: null, name: null, card_number: null, priority: 3 });
					seenIds.add(card.id);
				}
			}
		}
	} catch (err) {
		console.debug('[harvest] Priority 3 query failed:', err);
	}

	// Priority 4: Any card with stale prices (oldest first)
	const staleThreshold48h = Date.now() - 48 * 60 * 60 * 1000;
	const staleAny = [...pricedMap.entries()]
		.filter(([id, fetched]) =>
			!seenIds.has(id) && new Date(fetched).getTime() < staleThreshold48h
		)
		.sort((a, b) => new Date(a[1]).getTime() - new Date(b[1]).getTime());

	for (const [id] of staleAny) {
		candidates.push({ id, hero_name: null, name: null, card_number: null, priority: 4 });
		seenIds.add(id);
	}

	// Apply offset and limit, then hydrate with card details
	const finalSlice = candidates.slice(offset, offset + limit);
	return hydrateCards(admin, finalSlice);
}

async function hydrateCards(
	admin: NonNullable<ReturnType<typeof getAdminClient>>,
	candidates: CardCandidate[]
): Promise<CardCandidate[]> {
	if (candidates.length === 0) return [];

	const ids = candidates.map(c => c.id);
	const { data: cards } = await admin
		.from('cards')
		.select('id, hero_name, name, card_number')
		.in('id', ids);

	if (!cards) return [];

	const cardMap = new Map<string, { hero_name: string | null; name: string | null; card_number: string | null }>();
	for (const card of cards) {
		cardMap.set(card.id, card);
	}

	return candidates
		.map(c => {
			const details = cardMap.get(c.id);
			if (!details) return null;
			return { ...c, ...details };
		})
		.filter((c): c is CardCandidate => c !== null);
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
	const heroOrName = card.hero_name || card.name || '';
	const cardNum = card.card_number || '';
	const query = `bo jackson battle arena ${heroOrName} ${cardNum}`.trim();
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
		const items: Array<{
			price?: { value?: string };
			buyingOptions?: string[];
		}> = data.itemSummaries || [];

		const ebayResultsRaw = items.length;

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
			filtered_count: allStats?.filteredCount ?? allPrices.length,
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
