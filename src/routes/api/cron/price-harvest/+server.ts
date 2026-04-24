/**
 * GET /api/cron/price-harvest — Self-chaining eBay price harvester
 *
 * Triggered EXCLUSIVELY by QStash (via /api/cron/qstash-harvest which forwards
 * here server-to-server, bypassing Vercel Deployment Protection). Do NOT
 * re-enable a Vercel cron for this endpoint — QStash is the single source of
 * truth to prevent duplicate harvest runs. See vercel.json (no `crons` entry).
 *
 * Processes a batch of cards, then fires a fetch() to itself to continue.
 * Repeats until eBay quota is exhausted or the harvest window closes.
 *
 * Auth: CRON_SECRET header. The qstash-harvest endpoint injects this after
 * verifying the QStash signature. Also usable by the admin trigger-harvest
 * endpoint for manual runs.
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
import {
	buildWondersEbayQuery,
	filterRelevantWondersListings,
	scoreWondersListingMatch,
} from '$lib/server/ebay-query-wonders';
import { captureCardImage } from '$lib/services/image-harvester';
import type { RequestHandler } from './$types';

// Vercel Hobby supports up to 60s
export const config = { maxDuration: 60 };

const CARDS_PER_RUN = 25;       // Max cards per invocation (time-check is the real limiter)
const CARD_DELAY_MS = 2000;     // 2s between eBay calls — stays under burst limit
const MAX_CHAIN_DEPTH = 1500;   // Safety cap (~33K cards max across all chains)
const RESERVE_CALLS = 0;        // Harvester gets 100% of budget

/**
 * Refund an eBay call counter increment. Call this when an eBay request failed
 * in a way that didn't consume real quota — namely 429 responses (rate-limited,
 * no quota consumed) or thrown network errors (request never reached eBay).
 *
 * Without this, our self-imposed 4500-call cap trips early as the counter
 * drifts above actual eBay usage, stalling the harvester before quota is real.
 */
async function refundEbayCall(
	redis: NonNullable<ReturnType<typeof getRedis>>,
	today: string,
	reason: string,
	cardId?: string
): Promise<void> {
	try {
		const key = `ebay-calls:${today}`;
		const count = await redis.decr(key);
		// decr can go negative if we over-refund; clamp back to 0.
		if (count < 0) await redis.set(key, 0, { ex: 86400 });
		console.debug(`[harvest] Refunded ebay-calls counter (${reason}) card=${cardId ?? 'n/a'} new_count=${Math.max(0, count)}`);
	} catch (err) {
		console.debug('[harvest] Counter refund failed:', err instanceof Error ? err.message : err);
	}
}

export const GET: RequestHandler = async ({ request, url }) => {
	// ── Auth ─────────────────────────────────────────────
	const authHeader = request.headers.get('authorization');
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		// Log attempted-access context for post-hoc investigation.
		// Session 2.13 observed seven rapid 401s (possibly external scraper,
		// possibly stale QStash schedule); without UA we couldn't tell which.
		// Does NOT rate-limit — just logs. Safe to spam, cheap to capture.
		console.warn('[harvest] Unauthorized request', {
			userAgent: request.headers.get('user-agent') ?? 'none',
			forwardedFor: request.headers.get('x-forwarded-for') ?? 'none',
			hasAuthHeader: Boolean(authHeader),
			authPrefix: authHeader ? authHeader.slice(0, 7) : 'none'
		});
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

	// ── Fetch prioritized card list (multi-game) ────────────
	// Split budget 50/50 and call Wonders first so it consumes its share before
	// BoBA. If Wonders returns fewer candidates than its budget (once all ~1,000
	// Wonders cards are priced), the unused remainder flows to BoBA. This is
	// self-balancing without a hard ratio that has to be hand-tuned.
	const halfBudget = Math.max(1, Math.floor(callBudget / 2));
	const wondersCandidates = await getNextCandidates(admin, halfBudget, today, 'wonders');
	const wondersConsumed = wondersCandidates.length;
	const bobaBudget = Math.max(1, callBudget - wondersConsumed);
	const bobaCandidates = await getNextCandidates(admin, bobaBudget, today, 'boba');
	const candidates = [...wondersCandidates, ...bobaCandidates];
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
	// When called by trigger-harvest, use a shorter time budget so the
	// wrapper function has headroom within its own 60s Vercel limit.
	const timeBudgetHeader = request.headers.get('x-harvest-time-budget');
	const maxProcessingMs = timeBudgetHeader
		? Math.min(parseInt(timeBudgetHeader, 10) || 52000, 52000)
		: 52000;
	// Reserve 8s for logging + chain fire
	const processingCutoff = maxProcessingMs - 8000;
	// Reserve ~12s of the processing window for the play card pass so it
	// isn't time-starved by the hero loop. Heroes must stop at heroCutoff
	// to leave room for 5 plays × ~2s each + CARD_DELAY_MS margin.
	// Session 2.12 reserved the eBay call budget but left the time budget
	// shared; session 2.13 carves a dedicated time slice for plays.
	const PLAY_TIME_RESERVE_MS = 12000;
	const heroCutoff = processingCutoff - PLAY_TIME_RESERVE_MS;

	const startTime = Date.now();
	let processed = 0;
	let updated = 0;
	let errors = 0;
	let consecutive429s = 0;
	const harvestLogs: Record<string, unknown>[] = [];

	for (let i = 0; i < candidates.length; i++) {
		// Stop before timeout to leave room for logging + chain fire,
		// and to preserve the PLAY_TIME_RESERVE_MS slice for plays.
		if (Date.now() - startTime > heroCutoff) break;

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
			}

			if (result.logEntry) {
				harvestLogs.push(result.logEntry);
				// Track 429s from the error message
				const errMsg = String(result.logEntry.error_message || '');
				if (errMsg.includes('429')) {
					consecutive429s++;
				} else {
					// Any non-429 response (success OR other error) resets the
					// consecutive 429 counter — only sequential 429s should stop the chain
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

	// Skip self-chaining when triggered manually (browser handles the loop)
	const noChain = request.headers.get('x-harvest-no-chain') === 'true';

	// ── Play card pass (reserved floor of 5 per run) ──────
	// Previously: `Math.min(10, CARDS_PER_RUN - processed)` — but since
	// heroes always consume the full CARDS_PER_RUN=25 budget in refresh
	// mode, `CARDS_PER_RUN - processed` was always 0 and plays were
	// permanently skipped. 409 plays × 0% searched confirmed.
	//
	// Now: guarantee a floor of 5 play slots per run. With 12 harvest
	// runs per hour, the 409 cards clear first-pass in ~7 hours; after
	// that the RPC returns fewer candidates as priced ones age out of
	// the refresh window, so the reserved slots yield back naturally.
	// No hard change to total eBay call cost — the extra 5 plays per
	// run are still bounded by the 5000/day quota check at the top.
	// Session 2.14: removed `!noChain &&` from this guard. The `noChain` header
	// is set by the QStash wrapper (qstash-harvest/+server.ts:79) to prevent
	// the cron endpoint from self-chaining another QStash link — that intent
	// is correctly enforced at the chain-fire block below (line ~290). It was
	// NEVER meant to gate the play card pass. Because every production run is
	// QStash-triggered, `noChain` was always true in prod, and the play pass
	// was always skipped — explaining 0 rows in play_price_cache despite 2.12's
	// eBay call budget floor and 2.13's time budget carve-out both landing.
	if (consecutive429s < 3) {
		let playUsed = 0;
		try {
			const PLAY_FLOOR = 5;
			const PLAY_CAP = 10;
			const playBudget = Math.max(PLAY_FLOOR, Math.min(PLAY_CAP, CARDS_PER_RUN - processed));
			if (playBudget > 0) {
				const playCandidates = await getPlayCandidates(admin, playBudget);

				for (let i = 0; i < playCandidates.length; i++) {
					if (Date.now() - startTime > processingCutoff) break;
					if (consecutive429s >= 3) break;

					const playCard = playCandidates[i];
					try {
						const result = await refreshPlayCardPrice(admin, playCard, redis, today, chainDepth, confidenceThreshold);
						playUsed++;
						if (result.logEntry) {
							const errMsg = String(result.logEntry.error_message || '');
							if (errMsg.includes('429')) {
								consecutive429s++;
							} else {
								consecutive429s = 0;
							}
						}
					} catch (err) {
						console.error(`[harvest] Play card ${playCard.id} threw:`, err instanceof Error ? err.message : err);
						playUsed++;
					}

					if (i < playCandidates.length - 1) {
						await new Promise(r => setTimeout(r, CARD_DELAY_MS));
					}
				}

				// Play card harvest results are tracked via play_price_cache.fetched_at
				// rather than price_harvest_log (which has UUID card_id constraint).

				processed += playUsed;
				console.log(`[harvest] Play card pass: ${playUsed} processed`);
			}
		} catch (err) {
			console.warn('[harvest] Play card pass failed:', err instanceof Error ? err.message : err);
		}
	}

	// ── Fire next chain link ─────────────────────────────
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
//
// Phase 2.5 note: the RPC returns `(id, parallel, ...)` pairs drawn from
// the union of parallels seen in active `collections` and
// `listing_templates` rows for each card, plus `cards.parallel` as the
// baseline. The `card_parallel_name` column carries the rich per-card
// parallel name from cards.parallel; the `parallel` column carries the
// downstream value (which equals `card_parallel_name` for BoBA after the
// 2.1a.4/5 backfill).

interface CardCandidate {
	id: string;
	hero_name: string | null;
	name: string | null;
	card_number: string | null;
	athlete_name: string | null;
	/** cards.parallel — the rich per-card parallel name (e.g. "Battlefoil"). */
	card_parallel_name?: string | null;
	weapon_type: string | null;
	priority: number;
	/** Downstream parallel column value. For BoBA equals card_parallel_name
	 *  (post-backfill); for Wonders is the active foil parallel name. */
	parallel?: string | null;
	/** Phase 3: game_id routes to the right query builder (BoBA vs Wonders). */
	game_id?: string | null;
	/** Phase 3: metadata used by the Wonders query builder for set display name. */
	metadata?: Record<string, unknown> | null;
}

async function getNextCandidates(
	admin: NonNullable<ReturnType<typeof getAdminClient>>,
	limit: number,
	today: string,
	gameId: 'boba' | 'wonders' = 'boba'
): Promise<CardCandidate[]> {
	// Supabase types don't include p_game_id yet — cast through unknown so the
	// optional parameter typechecks. The RPC defaults game_id to 'boba'.
	const rpcArgs = {
		p_run_id: today,
		p_limit: limit,
		p_game_id: gameId,
	} as unknown as { p_run_id: string; p_limit: number };

	const { data, error: rpcError } = await admin.rpc('get_harvest_candidates', rpcArgs);

	if (rpcError) {
		console.error(`[harvest] get_harvest_candidates RPC failed (game=${gameId}):`, rpcError);
		return [];
	}

	// Normalize: default parallel to cards.parallel (or 'Paper') and tag
	// game_id on each candidate so downstream refreshCardPrice() routes to
	// the right query builder.
	const raw = (data as unknown as CardCandidate[]) || [];
	return raw.map((r) => ({
		...r,
		parallel: r.parallel || r.card_parallel_name || 'Paper',
		game_id: r.game_id || gameId
	}));
}

/**
 * Fetch play card candidates from the play_cards table.
 * Uses a separate RPC that returns TEXT IDs (not UUIDs).
 */
async function getPlayCandidates(
	admin: NonNullable<ReturnType<typeof getAdminClient>>,
	limit: number
): Promise<CardCandidate[]> {
	const { data, error: rpcError } = await admin.rpc('get_play_harvest_candidates', {
		p_limit: limit
	});

	if (rpcError) {
		console.error('[harvest] get_play_harvest_candidates RPC failed:', rpcError);
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
	// Phase 2.5 / 3: the harvester operates on (card_id, parallel) pairs and
	// dispatches query/filter builders by game_id. BoBA uses ebay-query.ts;
	// Wonders uses ebay-query-wonders.ts (quoted phrases + parallel keywords
	// + cross-game contamination rejection).
	const parallel = card.parallel || card.card_parallel_name || 'Paper';
	const gameId = (card.game_id || 'boba').toLowerCase();
	const isWonders = gameId === 'wonders';
	// Build the EbayCardInfo shape the Wonders query builder expects.
	const wondersCardInfo = {
		hero_name: card.hero_name,
		name: card.name,
		card_number: card.card_number,
		parallel,
		game_id: 'wonders' as const,
		metadata: card.metadata ?? null,
	};
	const query = isWonders ? buildWondersEbayQuery(wondersCardInfo) : buildEbaySearchQuery(card);
	const callStart = Date.now();

	// Increment Redis counter BEFORE the call
	try {
		const key = `ebay-calls:${today}`;
		const count = await redis.incr(key);
		if (count === 1) await redis.expire(key, 86400);
	} catch (err) { console.debug('[harvest] Redis counter increment failed:', err instanceof Error ? err.message : err); }

	// Fetch previous price for delta tracking (parallel-scoped)
	let previousMid: number | null = null;
	let isNewPrice = false;
	try {
		const { data: cached } = await admin
			.from('price_cache')
			.select('price_mid')
			.eq('card_id', card.id)
			.eq('source', 'ebay')
			.eq('parallel', parallel)
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
			// 429 = rate limited — no quota was actually consumed, refund the counter
			// so our self-imposed cap doesn't drift above real eBay usage.
			if (res.status === 429) {
				await refundEbayCall(redis, today, '429 response', card.id);
			}
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
			image?: { imageUrl?: string };
			thumbnailImages?: Array<{ imageUrl?: string }>;
		}> = data.itemSummaries || [];

		const ebayResultsRaw = rawItems.length;

		// Filter to listings that actually match this card (game-aware)
		const items = isWonders
			? filterRelevantWondersListings(rawItems, wondersCardInfo)
			: filterRelevantListings(rawItems, card);

		// Piggyback: harvest image from first relevant listing (BoBA only). Fire-and-forget.
		if (!isWonders && items.length > 0) {
			void captureCardImage(card.id, items[0], 'boba');
		}

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

		// Phase 3: for Wonders, refine confidence using the listing title scorer
		// so we don't accept loose name-only matches. Average across items.
		let adjustedConfidence = allStats?.confidenceScore ?? 0;
		if (isWonders && items.length > 0) {
			const titleScores = items.map((it) => scoreWondersListingMatch(it.title || '', wondersCardInfo));
			const avgTitleScore = titleScores.reduce((a, b) => a + b, 0) / titleScores.length;
			// Blend: 60% existing signal (price stability / listing count), 40% title match
			adjustedConfidence = adjustedConfidence * 0.6 + avgTitleScore * 0.4;
		}

		// Cold-start: new (card_id, parallel) pairs are provisional for their first
		// few harvests. The UI shows provisional prices with an asterisk + tooltip.
		// Uses isNewPrice (no prior price_cache row) as the signal.
		const coldStart = isWonders && isNewPrice;

		const priceData: Record<string, unknown> = {
			card_id: card.id,
			source: 'ebay',
			parallel,
			game_id: card.game_id || 'boba',
			price_low: allStats?.low ?? null,
			price_mid: allStats?.median ?? null,
			price_high: allStats?.high ?? null,
			listings_count: allPrices.length,
			buy_now_low: fixedStats?.low ?? null,
			buy_now_mid: fixedStats?.median ?? null,
			buy_now_count: fixedPrices.length,
			filtered_count: allStats?.filteredCount ?? 0,
			confidence_score: adjustedConfidence,
			confidence_cold_start: coldStart,
			fetched_at: new Date().toISOString()
		};

		// Check confidence threshold before accepting price
		const meetsThreshold = adjustedConfidence >= confidenceThreshold;

		// Always upsert price_cache so the card is marked as "searched".
		// Cards below threshold get cached with null prices (searched, no price)
		// so they drop to stale priority instead of being re-searched as "unpriced".
		const cachePayload: Record<string, unknown> = meetsThreshold
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
		// Upsert key is (card_id, source, parallel).
		const { error: cacheError } = await (admin.from('price_cache') as unknown as {
			upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
		}).upsert(cachePayload, { onConflict: 'card_id,source,parallel' });
		if (cacheError) {
			console.error(`[harvest] price_cache upsert FAILED for ${card.id}:`, cacheError.message);
		}

		// Write price history only if price changed AND meets threshold
		const newMid = priceData.price_mid !== null ? Number(priceData.price_mid) : null;
		const priceChanged = previousMid !== newMid;

		if (meetsThreshold && (!previousMid || priceChanged)) {
			const historyRow: Record<string, unknown> = {
				card_id: card.id,
				source: 'ebay',
				parallel,
				game_id: card.game_id || 'boba',
				price_low: priceData.price_low,
				price_mid: priceData.price_mid,
				price_high: priceData.price_high,
				listings_count: priceData.listings_count,
				recorded_at: new Date().toISOString()
			};
			const { error: historyError } = await (admin.from('price_history') as unknown as {
				insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
			}).insert(historyRow);
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
				// Phase 3: tag the harvest log row with game + parallel.
				game_id: card.game_id || 'boba',
				parallel,
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
		// Thrown error = fetch failed before reaching eBay. Refund the counter.
		await refundEbayCall(redis, today, 'fetch threw', card.id);
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
 * Refresh price for a play card. Identical logic to refreshCardPrice
 * but writes to play_price_cache (TEXT card_id) instead of price_cache (UUID).
 */
async function refreshPlayCardPrice(
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
			.from('play_price_cache')
			.select('price_mid')
			.eq('card_id', card.id)
			.eq('source', 'ebay')
			.maybeSingle();

		if (cached) {
			previousMid = (cached as { price_mid: number | null }).price_mid !== null
				? Number((cached as { price_mid: number | null }).price_mid)
				: null;
		} else {
			isNewPrice = true;
		}
	} catch (err) { console.debug('[harvest] Play card previous price fetch failed:', err instanceof Error ? err.message : err); }

	try {
		const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
		searchUrl.searchParams.set('q', query);
		searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
		searchUrl.searchParams.set('limit', '50');

		const res = await ebayFetch(searchUrl.toString());
		if (!res.ok) {
			// 429 = rate limited — no quota was actually consumed, refund the counter.
			if (res.status === 429) {
				await refundEbayCall(redis, today, '429 response (play card)', card.id);
			}
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
			image?: { imageUrl?: string };
			thumbnailImages?: Array<{ imageUrl?: string }>;
		}> = data.itemSummaries || [];

		const ebayResultsRaw = rawItems.length;
		const items = filterRelevantListings(rawItems, card);

		// Piggyback: harvest image from first relevant listing. Fire-and-forget.
		if (items.length > 0) {
			void captureCardImage(card.id, items[0], 'boba');
		}

		const fixedPriceItems = items.filter(item =>
			item.buyingOptions?.includes('FIXED_PRICE')
		);

		const allPrices = items
			.map(item => parseFloat(item.price?.value || '0'))
			.filter(p => p > 0);

		const fixedPrices = fixedPriceItems
			.map(item => parseFloat(item.price?.value || '0'))
			.filter(p => p > 0);

		const allStats = calculatePriceStats(allPrices);
		const fixedStats = calculatePriceStats(fixedPrices);

		const meetsThreshold = (allStats?.confidenceScore ?? 0) >= confidenceThreshold;

		// Upsert into play_price_cache (TEXT card_id — no UUID constraint)
		const cachePayload = {
			card_id: card.id,
			source: 'ebay',
			price_low: meetsThreshold ? (allStats?.low ?? null) : null,
			price_mid: meetsThreshold ? (allStats?.median ?? null) : null,
			price_high: meetsThreshold ? (allStats?.high ?? null) : null,
			listings_count: allPrices.length,
			buy_now_low: meetsThreshold ? (fixedStats?.low ?? null) : null,
			buy_now_mid: meetsThreshold ? (fixedStats?.median ?? null) : null,
			buy_now_count: fixedPrices.length,
			filtered_count: allStats?.filteredCount ?? 0,
			confidence_score: allStats?.confidenceScore ?? 0,
			fetched_at: new Date().toISOString()
		};

		const { error: cacheError } = await admin.from('play_price_cache').upsert(cachePayload, { onConflict: 'card_id,source' });
		if (cacheError) {
			console.error(`[harvest] play_price_cache upsert FAILED for ${card.id}:`, cacheError.message);
		}

		// Write price history if changed and meets threshold
		const newMid = meetsThreshold ? (allStats?.median ?? null) : null;
		const priceChanged = previousMid !== newMid;

		if (meetsThreshold && (!previousMid || priceChanged)) {
			const { error: historyError } = await admin.from('play_price_history').insert({
				card_id: card.id,
				source: 'ebay',
				price_low: allStats?.low ?? null,
				price_mid: allStats?.median ?? null,
				price_high: allStats?.high ?? null,
				listings_count: allPrices.length,
				recorded_at: new Date().toISOString()
			});
			if (historyError) {
				console.error(`[harvest] play_price_history insert FAILED for ${card.id}:`, historyError.message);
			}
		}

		return {
			success: true,
			logEntry: {
				error_message: null,
				success: true
			}
		};
	} catch (err) {
		// Thrown error = fetch failed before reaching eBay. Refund the counter.
		await refundEbayCall(redis, today, 'fetch threw (play card)', card.id);
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
		// Phase 3: tag the harvest log row with game + parallel so admin dashboards
		// can distinguish BoBA harvests from Wonders harvests.
		game_id: card.game_id || 'boba',
		parallel: card.parallel || card.card_parallel_name || 'Paper',
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
