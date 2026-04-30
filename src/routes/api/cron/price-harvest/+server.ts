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
import { isEbayConfigured } from '$lib/server/ebay-auth';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { Database } from '$lib/types/database';
import { getRedis, getHarvestConfidenceThreshold } from '$lib/server/redis';
import { calculatePriceStats } from '$lib/utils/pricing';
import { captureCardImage } from '$lib/services/image-harvester';
import { isFeatureEnabledGlobally } from '$lib/server/feature-flags';
import { logEvent } from '$lib/server/diagnostics';
import { persistObservations } from '$lib/server/harvester/listing-observations';
import {
	getNextCandidates,
	getPlayCandidates,
	type CardCandidate
} from '$lib/server/harvester/candidates';
import { searchAndEvaluate } from '$lib/server/harvester/ebay-search';
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
	// Pull half-budget from each game in parallel. Then interleave so the time
	// cutoff doesn't preferentially starve whichever game is concatenated second.
	// Self-balancing: if one side returns fewer candidates than halfBudget,
	// the longer list's tail still gets processed — interleave just guarantees
	// fairness up to min(boba.len, wonders.len) rows.
	// BoBA goes first within each pair: it's currently the staler queue, so
	// pulling it to the front of the time budget recovers freshness fastest.
	const halfBudget = Math.max(1, Math.floor(callBudget / 2));
	const [wondersCandidates, bobaCandidates] = await Promise.all([
		getNextCandidates(admin, halfBudget, today, 'wonders'),
		getNextCandidates(admin, halfBudget, today, 'boba')
	]);
	const candidates: CardCandidate[] = [];
	const longest = Math.max(wondersCandidates.length, bobaCandidates.length);
	for (let i = 0; i < longest; i++) {
		if (i < bobaCandidates.length) candidates.push(bobaCandidates[i]);
		if (i < wondersCandidates.length) candidates.push(wondersCandidates[i]);
	}
	console.log(
		`[harvest] candidates: boba=${bobaCandidates.length} wonders=${wondersCandidates.length} interleaved=${candidates.length}`
	);
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

	// Read the image-harvest kill-switch once per run. When false (the
	// default), the per-card captureCardImage piggyback is skipped — the
	// dedicated /api/cron/image-harvest endpoint owns that work on its own
	// hourly cadence. Caching inside isFeatureEnabledGlobally keeps repeat
	// reads cheap if the helper is reused elsewhere later.
	const imageCaptureEnabled = await isFeatureEnabledGlobally(
		'image_harvest_in_price_cron_v1'
	);
	if (!imageCaptureEnabled) {
		console.log(
			'[harvest:image] skipped — flag image_harvest_in_price_cron_v1 disabled'
		);
	}

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
			const result = await refreshCardPrice(admin, card, redis, today, chainDepth, confidenceThreshold, imageCaptureEnabled);
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
			void logEvent({
				level: 'error',
				event: 'harvest.boba.card_threw_unexpectedly',
				error: err,
				context: { card_id: card.id, card_number: card.card_number, game_id: card.game_id ?? null }
			});
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
			void logEvent({
				level: 'error',
				event: 'harvest.log_batch_insert_failed',
				error: err,
				context: { batch_size: harvestLogs.length }
			});
		}
	}

	// Skip self-chaining when triggered manually (browser handles the loop)
	const noChain = request.headers.get('x-harvest-no-chain') === 'true';

	// ── Play card pass (reserved floor of 5 per run) ──────
	//
	// IMPORTANT ASYMMETRY: plays log to `play_price_cache.fetched_at`
	// for observability, NOT to `price_harvest_log`. Why: play_cards.id
	// is TEXT (e.g. "A---PL-2"), but price_harvest_log.card_id is UUID.
	// Any admin report that JOINs price_harvest_log will see zero plays
	// — that's by design, not a bug. For play harvest observability:
	//     SELECT COUNT(*), MAX(fetched_at) FROM public.play_price_cache;
	//
	// BUDGET HISTORY:
	// - Pre-2.12: `Math.min(10, CARDS_PER_RUN - processed)`. Heroes
	//   consumed the full CARDS_PER_RUN=25 in refresh mode, so this
	//   was always 0. Plays never ran.
	// - 2.12: Floor to 5 via Math.max(5, ...). Fixed the arithmetic.
	// - 2.13: Added heroCutoff so heroes don't time-starve plays.
	// - 2.14: Removed spurious `!noChain &&` outer gate that skipped
	//   the whole block whenever QStash was the trigger (which is every
	//   production run). That last fix is the one that actually made
	//   plays start writing.
	//
	// 409 plays × 5/run × 12 runs/hour → ~7 hours for first full pass.
	// After that the RPC returns fewer candidates, reserved slots yield
	// back to heroes. Total eBay call budget still bounded by the 5000/day
	// quota check at the top of the handler.
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
						const result = await refreshPlayCardPrice(admin, playCard, redis, today, chainDepth, confidenceThreshold, imageCaptureEnabled);
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
						void logEvent({
							level: 'error',
							event: 'harvest.play.card_threw',
							error: err,
							context: { card_id: playCard.id }
						});
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
			void logEvent({ level: 'warn', event: 'harvest.play.pass_failed', error: err });
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

// ── Single card price refresh ───────────────────────────────
// Candidate selection lives in $lib/server/harvester/candidates.
// eBay search + filter dispatch lives in $lib/server/harvester/ebay-search.

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
	confidenceThreshold: number,
	imageCaptureEnabled: boolean
): Promise<RefreshResult> {
	const parallel = card.card_parallel_name || card.parallel || 'paper';
	const gameId = (card.game_id || 'boba').toLowerCase();
	const isWonders = gameId === 'wonders';
	const callStart = Date.now();

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
	} catch (err) {
		console.debug('[harvest] Previous price fetch failed (delta tracking):', err instanceof Error ? err.message : err);
	}

	const outcome = await searchAndEvaluate(card, parallel, redis, today);

	if (!outcome.ok) {
		return {
			success: false,
			logEntry: buildLogEntry(card, outcome.query, chainDepth, today, callStart, {
				success: false,
				error_message: outcome.errorMessage ?? 'Unknown error',
				isNewPrice,
				previousMid
			})
		};
	}

	const { items, decisions, rawCount: ebayResultsRaw, query, wondersAvgTitleScore } = outcome;

	// Persist per-listing observations + image dedupe. Best-effort.
	try {
		await persistObservations(
			admin,
			{ id: card.id, game_id: card.game_id ?? gameId, parallel },
			today,
			decisions
		);
	} catch (err) {
		console.error(
			'[harvest:observations] non-fatal:',
			err instanceof Error ? err.message : err
		);
	}

	// Piggyback: harvest image from first relevant listing (BoBA only).
	// Fire-and-forget. Gated by image_harvest_in_price_cron_v1.
	if (imageCaptureEnabled && !isWonders && items.length > 0) {
		void captureCardImage(card.id, items[0], 'boba');
	}

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

	// Phase 3: for Wonders, blend the title scorer into confidence.
	let adjustedConfidence = allStats?.confidenceScore ?? 0;
	if (isWonders && wondersAvgTitleScore !== null) {
		adjustedConfidence = adjustedConfidence * 0.6 + wondersAvgTitleScore * 0.4;
	}

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

	const meetsThreshold = adjustedConfidence >= confidenceThreshold;

	const cachePayload: Record<string, unknown> = meetsThreshold
		? priceData
		: {
			...priceData,
			price_low: null,
			price_mid: null,
			price_high: null,
			buy_now_low: null,
			buy_now_mid: null,
		};
	const { error: cacheError } = await (admin.from('price_cache') as unknown as {
		upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
	}).upsert(cachePayload, { onConflict: 'card_id,source,parallel' });
	if (cacheError) {
		console.error(`[harvest] price_cache upsert FAILED for ${card.id}:`, cacheError.message);
		void logEvent({
			level: 'error',
			event: 'harvest.price_cache_upsert_failed',
			error: cacheError.message,
			context: { card_id: card.id, parallel }
		});
	}

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
			void logEvent({
				level: 'error',
				event: 'harvest.price_history_insert_failed',
				error: historyError.message,
				context: { card_id: card.id, parallel }
			});
		}
	}

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
}

/**
 * Refresh price for a play card. Identical logic to refreshCardPrice
 * but writes to play_price_cache (TEXT card_id) instead of price_cache (UUID).
 *
 * play_price_cache has no parallel column, so we don't persist parallel for
 * plays; pass 'paper' to searchAndEvaluate so the BoBA query builder is used.
 */
async function refreshPlayCardPrice(
	admin: NonNullable<ReturnType<typeof getAdminClient>>,
	card: CardCandidate,
	redis: NonNullable<ReturnType<typeof getRedis>>,
	today: string,
	chainDepth: number,
	confidenceThreshold: number,
	imageCaptureEnabled: boolean
): Promise<RefreshResult> {
	const callStart = Date.now();

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
	} catch (err) {
		console.debug('[harvest] Play card previous price fetch failed:', err instanceof Error ? err.message : err);
	}

	const outcome = await searchAndEvaluate(card, 'paper', redis, today);

	if (!outcome.ok) {
		return {
			success: false,
			logEntry: buildLogEntry(card, outcome.query, chainDepth, today, callStart, {
				success: false,
				error_message: outcome.errorMessage ?? 'Unknown error',
				isNewPrice,
				previousMid
			})
		};
	}

	const { items } = outcome;

	// Play cards skip ebay_listing_observations persistence by design — that
	// table is hero-only (UUID card_id constraint).

	if (imageCaptureEnabled && items.length > 0) {
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
		void logEvent({
			level: 'error',
			event: 'harvest.play.price_cache_upsert_failed',
			error: cacheError.message,
			context: { card_id: card.id }
		});
	}

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
			void logEvent({
				level: 'error',
				event: 'harvest.play.price_history_insert_failed',
				error: historyError.message,
				context: { card_id: card.id }
			});
		}
	}

	return {
		success: true,
		logEntry: {
			error_message: null,
			success: true
		}
	};
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
		parallel: card.card_parallel_name || card.parallel || 'paper',
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
