/**
 * Orchestrates a single WTP scrape pass:
 *   1. Fetch all WTP listings + load Wonders catalog lookup
 *   2. Bucket card-typed listings by matched card_id
 *   3. Aggregate per-card pricing (median ask, low, high, sold counts)
 *   4. Upsert into external_pricing (game_id='wonders')
 *   5. Append per-card audit rows to external_pricing_history
 *   6. Return a summary for the admin UI
 *
 * Intentionally takes an untyped SupabaseClient — the generated types do
 * not yet include game_id on external_pricing or external_pricing_history
 * at all, but both columns exist in production (game_id default 'boba').
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllWtpListings, type WtpListing } from './fetcher';
import { wtpTreatmentToParallel, isKnownWtpTreatment } from './inbound-mapping';

export interface ScrapeRunSummary {
	fetched_at: string;
	duration_ms: number;
	total_listings: number;
	active_count: number;
	sold_count: number;
	card_listings_count: number;
	matched_card_count: number;
	unmatched_listing_count: number;
	ambiguous_listing_count: number;
	upserted_rows: number;
	history_rows: number;
	unmapped_treatments: string[];
	unmapped_sets: string[];
	per_set_coverage: Record<string, { listings: number; matched: number }>;
	unmatched_samples: Array<
		Pick<WtpListing, 'card_name' | 'treatment' | 'set' | 'condition' | 'price' | 'status'>
	>;
}

interface CardLookup {
	// `${name lower-trim}|${parallel}` → card_id (collisions excluded)
	byNameParallel: Map<string, string>;
}

function readSetDisplayName(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== 'object') return null;
	const v = (metadata as Record<string, unknown>).set_display_name;
	return typeof v === 'string' && v.length > 0 ? v : null;
}

async function loadWondersLookup(supabase: SupabaseClient): Promise<{
	lookup: CardLookup;
	knownSets: Set<string>;
}> {
	const { data, error } = await supabase
		.from('cards')
		.select('id, name, parallel, set_code, metadata')
		.eq('game_id', 'wonders');
	if (error) throw error;

	const collisions = new Set<string>();
	const candidates = new Map<string, string>();
	const knownSets = new Set<string>();

	for (const c of (data ?? []) as Array<{
		id: string;
		name: string;
		parallel: string | null;
		set_code: string | null;
		metadata: unknown;
	}>) {
		const setDisplay = readSetDisplayName(c.metadata);
		if (setDisplay) knownSets.add(setDisplay);
		if (c.set_code) knownSets.add(c.set_code);

		if (!c.parallel) continue;
		const key = `${c.name.toLowerCase().trim()}|${c.parallel}`;
		if (collisions.has(key)) continue;
		if (candidates.has(key)) {
			collisions.add(key);
			candidates.delete(key);
		} else {
			candidates.set(key, c.id);
		}
	}
	return { lookup: { byNameParallel: candidates }, knownSets };
}

function median(nums: number[]): number {
	const sorted = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function runWtpScrape(supabase: SupabaseClient): Promise<ScrapeRunSummary> {
	const t0 = Date.now();

	const [listings, { lookup, knownSets }] = await Promise.all([
		fetchAllWtpListings(),
		loadWondersLookup(supabase)
	]);

	const cardListings = listings.filter((l) => l.listing_type === 'card');
	const seenTreatments = new Set(cardListings.map((l) => l.treatment));
	const seenSets = new Set(cardListings.map((l) => l.set));

	const unmappedTreatments = [...seenTreatments].filter((t) => !isKnownWtpTreatment(t));
	const unmappedSets = [...seenSets].filter((s) => !knownSets.has(s));

	const buckets = new Map<string, WtpListing[]>();
	const unmatched: WtpListing[] = [];
	const perSet: Record<string, { listings: number; matched: number }> = {};

	for (const l of cardListings) {
		perSet[l.set] ??= { listings: 0, matched: 0 };
		perSet[l.set].listings += 1;

		const parallel = wtpTreatmentToParallel(l.treatment);
		if (!parallel) {
			unmatched.push(l);
			continue;
		}
		const key = `${l.card_name.toLowerCase().trim()}|${parallel}`;
		const cardId = lookup.byNameParallel.get(key);
		if (!cardId) {
			unmatched.push(l);
			continue;
		}
		perSet[l.set].matched += 1;
		const arr = buckets.get(cardId);
		if (arr) arr.push(l);
		else buckets.set(cardId, [l]);
	}

	const now = new Date();
	const pullDate = now.toISOString().slice(0, 10);
	const cutoff30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

	const epRows: Array<Record<string, unknown>> = [];
	const historyRows: Array<Record<string, unknown>> = [];

	for (const [cardId, items] of buckets) {
		const active = items.filter((i) => i.status === 'active');
		const sold = items.filter((i) => i.status === 'sold');
		const sold30d = sold.filter((i) => new Date(i.updated_at) >= cutoff30d);

		// Active prices drive ep_price (asks). Skip if 0 active — external_pricing
		// is keyed UNIQUE on card_id so we just don't update for that card this run.
		if (active.length === 0) continue;

		const activePrices = active.map((i) => Number(i.price)).filter(Number.isFinite);
		if (activePrices.length === 0) continue;

		const sample = items[0];
		epRows.push({
			card_id: cardId,
			game_id: 'wonders',
			ep_price: median(activePrices),
			ep_low: Math.min(...activePrices),
			ep_high: Math.max(...activePrices),
			ep_source_id: `wtp:${sample.id}`,
			ep_card_name: sample.card_name,
			ep_set_name: sample.set,
			ep_variant: wtpTreatmentToParallel(sample.treatment),
			ep_rarity: sample.rarity,
			ep_image_url: sample.image_url ?? sample.image_urls?.[0] ?? null,
			ep_raw_data: { listings: items, ts: now.toISOString() },
			ep_updated: now.toISOString()
		});

		const sold30Prices = sold30d.map((i) => Number(i.price)).filter(Number.isFinite);
		const lastSale = sold.length
			? sold.reduce((a, b) => (a.updated_at > b.updated_at ? a : b))
			: null;

		historyRows.push({
			card_id: cardId,
			pull_date: pullDate,
			game_id: 'wonders',
			ep_price: median(activePrices),
			ep_total_sales: sold.length,
			ep_sales_30d: sold30d.length,
			ep_avg_30d: sold30Prices.length ? median(sold30Prices) : null,
			ep_last_sale_date: lastSale ? lastSale.updated_at.slice(0, 10) : null,
			ep_source_id: `wtp:bulk:${pullDate}`,
			ep_raw_data: { active_count: active.length, sold_count: sold.length }
		});
	}

	let upserted = 0;
	if (epRows.length) {
		const { error: upErr } = await supabase
			.from('external_pricing')
			.upsert(epRows, { onConflict: 'card_id' });
		if (upErr) throw upErr;
		upserted = epRows.length;
	}

	let historyCount = 0;
	if (historyRows.length) {
		const { error: histErr } = await supabase
			.from('external_pricing_history')
			.insert(historyRows);
		if (histErr) throw histErr;
		historyCount = historyRows.length;
	}

	return {
		fetched_at: now.toISOString(),
		duration_ms: Date.now() - t0,
		total_listings: listings.length,
		active_count: listings.filter((l) => l.status === 'active').length,
		sold_count: listings.filter((l) => l.status === 'sold').length,
		card_listings_count: cardListings.length,
		matched_card_count: epRows.length,
		unmatched_listing_count: unmatched.length,
		ambiguous_listing_count: 0,
		upserted_rows: upserted,
		history_rows: historyCount,
		unmapped_treatments: unmappedTreatments,
		unmapped_sets: unmappedSets,
		per_set_coverage: perSet,
		unmatched_samples: unmatched.slice(0, 50).map((l) => ({
			card_name: l.card_name,
			treatment: l.treatment,
			set: l.set,
			condition: l.condition,
			price: l.price,
			status: l.status
		}))
	};
}
