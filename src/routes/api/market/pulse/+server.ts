/**
 * GET /api/market/pulse — Aggregated market intelligence data
 *
 * Returns:
 * - movers: cards with biggest price changes (sorted by |deltaPct|)
 * - insights: confidence distribution, BIN premium rankings, harvest quality stats
 * - summary: total market value, gainer/loser counts, sentiment
 *
 * Data sources: price_cache + cards + price_history (last 14 data points per card)
 */

import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Sign in to view market data');

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database unavailable');

	// Fetch price_cache joined with card metadata.
	const { data: priceRows, error: priceErr } = await admin
		.from('price_cache')
		.select('card_id, price_low, price_mid, price_high, listings_count, buy_now_low, buy_now_mid, buy_now_count, filtered_count, confidence_score, fetched_at')
		.eq('source', 'ebay')
		.not('price_mid', 'is', null)
		.order('price_mid', { ascending: false })
		.limit(5000);

	if (priceErr) {
		console.error('[market/pulse] price_cache query failed:', priceErr);
		throw error(500, 'Failed to load market data');
	}

	if (!priceRows || priceRows.length === 0) {
		return json({ movers: [], insights: null, summary: null });
	}

	// Fetch card metadata for all priced cards
	const cardIds = priceRows.map(r => r.card_id);
	const { data: cardRows, error: cardErr } = await admin
		.from('cards')
		.select('id, hero_name, name, card_number, set_code, rarity')
		.in('id', cardIds)
		.limit(5000);

	if (cardErr) {
		console.error('[market/pulse] cards query failed:', cardErr.message);
		throw error(500, 'Failed to load card metadata');
	}

	const cardMap = new Map((cardRows || []).map(c => [c.id, c]));

	// Fetch most recent harvest log entry per card for delta tracking.
	const { data: harvestRows, error: harvestErr } = await admin
		.from('price_harvest_log')
		.select('card_id, previous_mid, price_delta, price_delta_pct, price_changed, auction_count, is_new_price, success')
		.eq('success', true)
		.in('card_id', cardIds)
		.order('processed_at', { ascending: false })
		.limit(10000);

	if (harvestErr) {
		console.error('[market/pulse] harvest_log query failed:', harvestErr.message);
	}

	// Deduplicate: keep only the most recent harvest entry per card_id
	const harvestMap = new Map<string, NonNullable<typeof harvestRows>[number]>();
	for (const row of harvestRows || []) {
		if (!harvestMap.has(row.card_id)) {
			harvestMap.set(row.card_id, row);
		}
	}

	// Fetch last 14 price_history data points per card for sparklines.
	const { data: historyRows, error: historyErr } = await admin
		.from('price_history')
		.select('card_id, price_mid, recorded_at')
		.in('card_id', cardIds)
		.order('recorded_at', { ascending: true })
		.limit(70000);

	if (historyErr) {
		console.error('[market/pulse] price_history query failed:', historyErr.message);
	}

	const historyMap = new Map<string, number[]>();
	for (const row of historyRows || []) {
		if (!historyMap.has(row.card_id)) historyMap.set(row.card_id, []);
		historyMap.get(row.card_id)!.push(Number(row.price_mid));
	}
	// Keep only last 14 per card
	for (const [k, v] of historyMap) {
		historyMap.set(k, v.slice(-14));
	}

	// ── Build merged card objects ─────────────────────────
	interface MergedCard {
		id: string;
		hero: string;
		num: string;
		set: string;
		rarity: string;
		mid: number;
		low: number;
		high: number;
		bnMid: number | null;
		bnLow: number | null;
		bnCount: number;
		aucCount: number;
		listings: number;
		filtered: number;
		conf: number;
		prevMid: number | null;
		delta: number | null;
		deltaPct: number | null;
		bnPremium: number;
		history: number[];
	}

	const cards: MergedCard[] = [];
	for (const price of priceRows) {
		const card = cardMap.get(price.card_id);
		if (!card) continue;

		const harvest = harvestMap.get(price.card_id);
		const mid = Number(price.price_mid);
		const bnMid = price.buy_now_mid != null ? Number(price.buy_now_mid) : null;
		const prevMid = harvest?.previous_mid != null ? Number(harvest.previous_mid) : null;
		const delta = harvest?.price_delta != null ? Number(harvest.price_delta) : null;
		const deltaPct = harvest?.price_delta_pct != null ? Number(harvest.price_delta_pct) : null;
		const aucCount = harvest?.auction_count ?? 0;
		const bnCount = price.buy_now_count ?? 0;
		const bnPremium = (bnMid && mid && mid > 0) ? ((bnMid - mid) / mid) * 100 : 0;
		const history = historyMap.get(price.card_id) || [mid];

		cards.push({
			id: price.card_id,
			hero: card.hero_name || card.name || 'Unknown',
			num: card.card_number || '',
			set: card.set_code || '',
			rarity: card.rarity || 'Common',
			mid,
			low: Number(price.price_low ?? mid),
			high: Number(price.price_high ?? mid),
			bnMid,
			bnLow: price.buy_now_low != null ? Number(price.buy_now_low) : null,
			bnCount,
			aucCount,
			listings: price.listings_count ?? 0,
			filtered: price.filtered_count ?? 0,
			conf: Number(price.confidence_score ?? 0),
			prevMid,
			delta,
			deltaPct,
			bnPremium,
			history,
		});
	}

	// ── Insights ──────────────────────────────────────────
	const totalListings = cards.reduce((s, c) => s + c.listings, 0);
	const totalFiltered = cards.reduce((s, c) => s + c.filtered, 0);
	const avgConf = cards.length > 0 ? cards.reduce((s, c) => s + c.conf, 0) / cards.length : 0;

	// Confidence buckets: [0-20, 20-40, 40-60, 60-80, 80-100]
	const confBuckets = [0, 0, 0, 0, 0];
	cards.forEach(c => {
		const pct = c.conf * 100;
		if (pct < 20) confBuckets[0]++;
		else if (pct < 40) confBuckets[1]++;
		else if (pct < 60) confBuckets[2]++;
		else if (pct < 80) confBuckets[3]++;
		else confBuckets[4]++;
	});

	// BIN premium top cards (only cards with bnMid)
	const bnPremiumCards = [...cards]
		.filter(c => c.bnMid != null && c.bnPremium > 0)
		.sort((a, b) => b.bnPremium - a.bnPremium)
		.slice(0, 6)
		.map(c => ({ hero: c.hero, num: c.num, bnPremium: Math.round(c.bnPremium) }));

	// ── Summary ──────────────────────────────────────────
	const totalMkt = cards.reduce((s, c) => s + c.mid, 0);
	const prevMkt = cards.reduce((s, c) => s + (c.prevMid ?? c.mid), 0);
	const gainers = cards.filter(c => (c.deltaPct ?? 0) > 0.5).length;
	const losers = cards.filter(c => (c.deltaPct ?? 0) < -0.5).length;

	// ── Movers (sorted by |deltaPct|, only cards with actual changes) ──
	const movers = [...cards]
		.filter(c => c.deltaPct != null && Math.abs(c.deltaPct) > 0.1)
		.sort((a, b) => Math.abs(b.deltaPct!) - Math.abs(a.deltaPct!))
		.slice(0, 30);

	// Top gainer and loser for the headline cards
	const topGainer = [...cards].filter(c => c.deltaPct != null).sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0] || null;
	const topLoser = [...cards].filter(c => c.deltaPct != null).sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0))[0] || null;

	return json({
		summary: {
			totalMkt: Math.round(totalMkt * 100) / 100,
			prevMkt: Math.round(prevMkt * 100) / 100,
			mktDeltaPct: prevMkt > 0 ? Math.round(((totalMkt - prevMkt) / prevMkt) * 10000) / 100 : 0,
			totalCards: cards.length,
			gainers,
			losers,
			totalListings,
		},
		insights: {
			confBuckets,
			avgConf: Math.round(avgConf * 100),
			totalListings,
			totalFiltered,
			outliersRemoved: totalListings - totalFiltered,
			bnPremiumCards,
		},
		movers,
		topGainer,
		topLoser,
	}, {
		headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' }
	});
};
