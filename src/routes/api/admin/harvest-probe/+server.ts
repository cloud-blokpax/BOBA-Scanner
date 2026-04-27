/**
 * POST /api/admin/harvest-probe — non-destructive harvester diagnostic probe.
 *
 * Phase 1 of the price harvester investigation. For each card returned by
 * pick_harvest_probe_sample(), captures:
 *   - The exact eBay query string the harvester would build
 *   - The full URL hit (with all query parameters)
 *   - Every raw item summary returned by the Browse API
 *   - Per-listing accept/reject decisions plus the matched signal set
 *   - The buy-now / median-IQR price math output
 *
 * All four harvester functions are called UNCHANGED:
 *   - buildEbaySearchQuery / buildWondersEbayQuery
 *   - filterRelevantListings / filterRelevantWondersListings
 *   - calculatePriceStats
 *
 * The probe endpoint does NOT write to price_cache or price_history. The
 * only side effect is inserting rows into harvest_probe.
 *
 * Auth: admin-only via requireAdmin (mirrors other /api/admin/* endpoints).
 */

import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';

import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { isEbayConfigured, ebayFetch } from '$lib/server/ebay-auth';
import { apiError, serviceUnavailable } from '$lib/server/api-response';

import { buildEbaySearchQuery, filterRelevantListings } from '$lib/server/ebay-query';
import {
	buildWondersEbayQuery,
	filterRelevantWondersListings
} from '$lib/server/ebay-query-wonders';
import { calculatePriceStats } from '$lib/utils/pricing';

// Vercel Hobby supports up to 60s — at ~22 cards × ~1s each plus 200ms
// inter-card sleep, the run finishes well inside the limit.
export const config = { maxDuration: 60 };

const INTER_CARD_DELAY_MS = 200;

interface CardRow {
	id: string;
	name: string | null;
	hero_name: string | null;
	athlete_name: string | null;
	card_number: string | null;
	parallel: string | null;
	weapon_type: string | null;
	game_id: string | null;
	metadata: Record<string, unknown> | null;
}

interface RawEbayItem {
	itemId?: string;
	title?: string;
	price?: { value?: string; currency?: string };
	buyingOptions?: string[];
	condition?: string;
	conditionId?: string;
	itemWebUrl?: string;
	seller?: { username?: string };
	image?: { imageUrl?: string };
}

interface FilterDecision {
	itemId: string | undefined;
	title: string | undefined;
	accepted: boolean;
	rejection_reason: string | null;
	matched_signals: string[];
}

export const POST: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);

	if (!isEbayConfigured()) {
		return apiError('eBay not configured', 503, { code: 'EBAY_UNCONFIGURED' });
	}

	const admin = getAdminClient();
	if (!admin) return serviceUnavailable('Database');

	// Pull the curated sample. Persist run_id so reruns can be cross-referenced
	// even if pick_harvest_probe_sample shifts under us.
	const runId = randomUUID();
	type SampleRow = { card_id: string; bucket: string };
	// Cast the rpc name through unknown — Database types are generated from
	// schema and don't yet include this admin-only diagnostic RPC.
	const sampleRpc = (admin.rpc as unknown as (
		fn: string
	) => Promise<{ data: SampleRow[] | null; error: { message: string } | null }>)(
		'pick_harvest_probe_sample'
	);
	const { data: sample, error: sampleErr } = await sampleRpc;
	if (sampleErr) {
		return apiError(`Failed to pick sample: ${sampleErr.message}`, 500, {
			code: 'SAMPLE_FAILED'
		});
	}

	const samples = sample ?? [];
	if (samples.length === 0) {
		return json({ ok: true, run_id: runId, count: 0, results: [], note: 'sample empty' });
	}

	const results: Array<{
		bucket: string;
		card: string;
		raw: number;
		kept: number;
		query: string;
	}> = [];

	for (const row of samples) {
		await sleep(INTER_CARD_DELAY_MS);

		const t0 = Date.now();

		// Hydrate the full card row needed by the query/filter functions.
		const { data: cardData, error: cardErr } = await admin
			.from('cards')
			.select('id, name, hero_name, athlete_name, card_number, parallel, weapon_type, game_id, metadata')
			.eq('id', row.card_id)
			.maybeSingle();

		if (cardErr || !cardData) {
			console.warn('[harvest-probe] card hydrate failed', row.card_id, cardErr?.message);
			continue;
		}
		const card = cardData as unknown as CardRow;

		const isWonders = (card.game_id || 'boba').toLowerCase() === 'wonders';
		const parallel = card.parallel || 'Paper';

		// Build the EXACT input shape each query/filter function expects.
		// Matches the harvester at refreshCardPrice in the price-harvest cron.
		const queryCard = {
			hero_name: card.hero_name,
			name: card.name,
			athlete_name: card.athlete_name,
			card_number: card.card_number,
			parallel,
			weapon_type: card.weapon_type,
			game_id: card.game_id,
			metadata: card.metadata
		};

		const queryString = isWonders
			? buildWondersEbayQuery(queryCard)
			: buildEbaySearchQuery(queryCard);

		// Reproduce the harvester's exact request shape so the probe captures
		// the same data the production path sees. Do NOT wrap or modify
		// ebayFetch — just record what we send.
		const searchUrl = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
		searchUrl.searchParams.set('q', queryString);
		searchUrl.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE|AUCTION}');
		searchUrl.searchParams.set('limit', '50');
		const queryUrl = searchUrl.toString();

		let rawItems: RawEbayItem[] = [];
		let fetchErr: string | null = null;

		try {
			const res = await ebayFetch(queryUrl);
			if (res.ok) {
				const data = (await res.json()) as { itemSummaries?: RawEbayItem[] };
				rawItems = data.itemSummaries ?? [];
			} else {
				fetchErr = `eBay API ${res.status}`;
			}
		} catch (err) {
			fetchErr = err instanceof Error ? err.message : String(err);
		}

		// Run the production filter UNCHANGED. To produce per-listing decisions
		// we run it once with the full set (to match the production path), then
		// derive per-item accept/reject by membership. This avoids calling the
		// filter once per item, which would change its tier-cascade behavior
		// (the filter returns early on the first tier with hits).
		const acceptedSet = isWonders
			? new Set(filterRelevantWondersListings(rawItems, queryCard).map((it) => it.itemId))
			: new Set(filterRelevantListings(rawItems, queryCard).map((it) => it.itemId));

		const decisions: FilterDecision[] = rawItems.map((item) => {
			const accepted = acceptedSet.has(item.itemId);
			return {
				itemId: item.itemId,
				title: item.title,
				accepted,
				rejection_reason: accepted ? null : 'failed_filter',
				matched_signals: deriveMatchedSignals(item, card, parallel, isWonders)
			};
		});

		const filteredItems = rawItems.filter((it) => acceptedSet.has(it.itemId));

		// Reproduce the harvester's median+IQR math UNCHANGED. Split graded
		// from raw using the same heuristic the review packet looks at —
		// the price math itself is calculatePriceStats, the bucketing for
		// `excluded_lots_n` / `graded_n` is for the diagnostic only.
		const allPrices = filteredItems
			.map((it) => parseFloat(it.price?.value || '0'))
			.filter((p) => p > 0);
		const fixedPrices = filteredItems
			.filter((it) => it.buyingOptions?.includes('FIXED_PRICE'))
			.map((it) => parseFloat(it.price?.value || '0'))
			.filter((p) => p > 0);

		const allStats = calculatePriceStats(allPrices);
		const fixedStats = calculatePriceStats(fixedPrices);

		const gradedCount = filteredItems.filter((it) =>
			titleHasGradedMarker(it.title || '')
		).length;
		const lotCount = filteredItems.filter((it) =>
			titleHasLotMarker(it.title || '')
		).length;

		const priceResult =
			filteredItems.length > 0
				? {
						raw_n: allPrices.length,
						raw_median: allStats?.median ?? null,
						raw_after_iqr: allStats?.filteredCount ?? 0,
						buy_now_n: fixedPrices.length,
						buy_now_median: fixedStats?.median ?? null,
						buy_now_after_iqr: fixedStats?.filteredCount ?? 0,
						graded_n: gradedCount,
						excluded_lots_n: lotCount
					}
				: null;

		const probeRow = {
			run_id: runId,
			card_id: card.id,
			card_snapshot: {
				card_number: card.card_number,
				name: card.name,
				parallel,
				hero_name: card.hero_name,
				athlete_name: card.athlete_name,
				game_id: card.game_id ?? 'boba'
			},
			query_string: queryString,
			query_url: queryUrl,
			raw_count: rawItems.length,
			raw_listings: rawItems.map((i) => ({
				itemId: i.itemId,
				title: i.title,
				price: i.price?.value ?? null,
				currency: i.price?.currency ?? null,
				buyingOptions: i.buyingOptions ?? [],
				condition: i.condition ?? null,
				conditionId: i.conditionId ?? null,
				sellerUsername: i.seller?.username ?? null,
				itemWebUrl: i.itemWebUrl ?? null
			})),
			filter_decisions: decisions,
			filtered_count: filteredItems.length,
			price_result: priceResult,
			elapsed_ms: Date.now() - t0,
			notes: fetchErr ? `${row.bucket} | fetch_error: ${fetchErr}` : row.bucket
		};

		const { error: insertErr } = await (admin.from('harvest_probe') as unknown as {
			insert: (r: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
		}).insert(probeRow);

		if (insertErr) {
			console.error('[harvest-probe] insert failed', card.id, insertErr.message);
		}

		results.push({
			bucket: row.bucket,
			card: card.name ?? card.id,
			raw: rawItems.length,
			kept: filteredItems.length,
			query: queryString
		});
	}

	return json({ ok: true, run_id: runId, count: results.length, results });
};

// ── helpers ─────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Return the list of accept-conditions that passed for a listing. Surfaces
 * the seams that the review packet queries against — without this, the
 * raw filter_decisions field would only tell us pass/fail, not WHY.
 *
 * BoBA signals model the four-tier filter in ebay-query.ts. Wonders
 * signals model filterRelevantWondersListings in ebay-query-wonders.ts.
 */
function deriveMatchedSignals(
	item: RawEbayItem,
	card: CardRow,
	parallel: string,
	isWonders: boolean
): string[] {
	const title = (item.title ?? '').toUpperCase();
	const signals: string[] = [];

	if (!title) return signals;

	if (isWonders) {
		// Wonders game-anchor tokens
		if (/WONDERS OF THE FIRST|WOTF/.test(title)) signals.push('wonders_phrase');
		// BoBA contamination markers (filter rejects these)
		if (/BO JACKSON|BATTLE ARENA|BOBA/.test(title)) signals.push('boba_contamination');

		const cardName = (card.name || card.hero_name || '').toUpperCase().trim();
		if (cardName.length > 2 && includesAllWords(title, cardName)) signals.push('card_name');

		const cardNum = (card.card_number || '').toUpperCase().trim();
		const normalizedCardNum = cardNum.replace(/[-\s]/g, '');
		if (
			normalizedCardNum.length > 2 &&
			title.replace(/[-\s]/g, '').includes(normalizedCardNum)
		) {
			signals.push('card_number');
		}

		// Wonders parallel keyword presence (paper has no keyword requirement)
		const wondersKeyword = wondersParallelKeyword(parallel);
		if (wondersKeyword && title.includes(wondersKeyword.toUpperCase())) {
			signals.push('parallel_keyword');
		}
	} else {
		// BoBA game-anchor tokens
		if (title.includes('BATTLE ARENA') || title.includes('BOBA')) {
			signals.push('battle_arena_phrase');
		}

		const heroStr = (card.hero_name || card.name || '').toUpperCase().trim();
		if (heroStr.length > 2 && includesAllWords(title, heroStr)) signals.push('hero_name');

		const athleteStr = (card.athlete_name || '').toUpperCase().trim();
		if (athleteStr.length > 2 && includesAllWords(title, athleteStr)) {
			signals.push('athlete_name');
		}

		const cardNum = (card.card_number || '').toUpperCase();
		const normalizedCardNum = cardNum.replace(/[-\s]/g, '');
		if (
			normalizedCardNum.length > 2 &&
			title.replace(/[-\s]/g, '').includes(normalizedCardNum)
		) {
			signals.push('card_number');
		}

		const parallelStr = (parallel || '').toUpperCase().trim();
		if (parallelStr && parallelStr !== 'PAPER' && parallelStr !== 'BASE') {
			if (title.includes(parallelStr)) signals.push('parallel_name');
		}
	}

	// Game-agnostic noise markers — surfaced so the review packet can flag
	// graded listings leaking into the raw bucket and bundles dragging
	// the median.
	if (titleHasGradedMarker(item.title ?? '')) signals.push('graded_marker');
	if (titleHasLotMarker(item.title ?? '')) signals.push('lot_marker');

	return signals;
}

function includesAllWords(title: string, name: string): boolean {
	const words = name.split(/\s+/).filter((w) => w.length > 1);
	return words.length > 0 && words.every((w) => title.includes(w));
}

function titleHasGradedMarker(title: string): boolean {
	return /\b(PSA|BGS|SGC|CGC|TAG|GRADED|SLABBED)\b/i.test(title);
}

function titleHasLotMarker(title: string): boolean {
	return /\b(LOT OF|BUNDLE|COMPLETE SET|MIXED|COLLECTION|BULK|RANDOM)\b|\bX[2-9]\b/i.test(title);
}

function wondersParallelKeyword(parallel: string): string | null {
	const key = (parallel || '').trim().toLowerCase();
	switch (key) {
		case 'classic foil':
		case 'cf':
			return 'Classic Foil';
		case 'formless foil':
		case 'ff':
			return 'Formless Foil';
		case 'orbital color match':
		case 'ocm':
			return 'Orbital Color Match';
		case 'stonefoil':
		case 'sf':
			return 'Stonefoil';
		default:
			return null;
	}
}
