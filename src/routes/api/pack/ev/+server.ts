/**
 * POST /api/pack/ev — Monte Carlo box EV simulation.
 *
 * Runs N simulated boxes server-side using the pure openBox() from
 * pack-simulator, joined against price_cache for deterministic pricing.
 * Returns a statistical summary for display on /packs/ev.
 *
 * Request body:  { setCode: string; boxType: 'blaster'|'double_mega'|'hobby'|'jumbo'; iterations?: number }
 * Response:      { ev, median, p10, p90, p99, msrp, breakEvenPct, jackpotPct, avgParallelsByType, topHits, iterations, priceCoverage }
 *
 * Anonymous access allowed with rate limiting — EV is a pre-purchase tool.
 */

import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkAnonPriceRateLimit } from '$lib/server/rate-limit';
import { openBox, type SimulatorSources } from '$lib/services/pack-simulator';
import { getBoxConfig } from '$lib/data/pack-defaults';
import type { RequestHandler } from './$types';
import type { PackResult } from '$lib/types/pack-simulator';

export const config = { maxDuration: 30 };

const DEFAULT_ITERATIONS = 500;
const MAX_ITERATIONS = 2000;

type CardRow = NonNullable<SimulatorSources['allCards']>[number];

interface CachedSnapshot {
	loadedAt: number;
	allCards: CardRow[];
	priceMap: Map<string, number>;
}
let _snapshot: CachedSnapshot | null = null;
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

async function loadSnapshot(): Promise<CachedSnapshot> {
	if (_snapshot && Date.now() - _snapshot.loadedAt < SNAPSHOT_TTL_MS) return _snapshot;

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database unavailable');

	const BATCH = 1000;
	let allCards: CardRow[] = [];
	let offset = 0;
	while (true) {
		const { data, error: err } = await admin
			.from('cards')
			.select('id, card_number, hero_name, set_code, weapon_type, rarity, parallel, name, power')
			.eq('game_id', 'boba')
			.range(offset, offset + BATCH - 1)
			.order('id');
		if (err) {
			console.error('[api/pack/ev] cards fetch error:', err);
			throw error(500, 'Card load failed');
		}
		if (!data || data.length === 0) break;
		allCards = allCards.concat(data as unknown as CardRow[]);
		if (data.length < BATCH) break;
		offset += BATCH;
	}

	// Play cards so play slots produce real cards
	const { data: plays } = await admin
		.from('play_cards')
		.select('id, card_number, name, release')
		.order('card_number');
	if (plays) {
		for (const p of plays) {
			allCards.push({
				id: p.id,
				card_number: p.card_number,
				name: p.name,
				set_code: p.release,
				hero_name: null,
				power: null,
				weapon_type: null,
				rarity: null,
				parallel: null,
				base_play_name: p.name,
			});
		}
	}

	const priceMap = new Map<string, number>();
	offset = 0;
	while (true) {
		const { data, error: err } = await admin
			.from('price_cache')
			.select('card_id, price_mid')
			.eq('source', 'ebay')
			.eq('parallel', 'Paper')
			.not('price_mid', 'is', null)
			.range(offset, offset + BATCH - 1);
		if (err) break;
		if (!data || data.length === 0) break;
		for (const row of data) {
			if (row.card_id && row.price_mid !== null) {
				priceMap.set(row.card_id as string, Number(row.price_mid));
			}
		}
		if (data.length < BATCH) break;
		offset += BATCH;
	}

	// Also load play_price_cache (may be empty today, but handle future data)
	offset = 0;
	while (true) {
		const { data, error: err } = await admin
			.from('play_price_cache')
			.select('card_id, price_mid')
			.eq('source', 'ebay')
			.not('price_mid', 'is', null)
			.range(offset, offset + BATCH - 1);
		if (err) break;
		if (!data || data.length === 0) break;
		for (const row of data) {
			if (row.card_id && row.price_mid !== null) {
				priceMap.set(row.card_id as string, Number(row.price_mid));
			}
		}
		if (data.length < BATCH) break;
		offset += BATCH;
	}

	_snapshot = { loadedAt: Date.now(), allCards, priceMap };
	return _snapshot;
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		const rateLimit = await checkAnonPriceRateLimit(getClientAddress());
		if (!rateLimit.success) return json({ error: 'Rate limited' }, { status: 429 });
	}

	let body: { setCode?: unknown; boxType?: unknown; iterations?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const setCode = typeof body.setCode === 'string' ? body.setCode : null;
	const boxType = typeof body.boxType === 'string' ? body.boxType : null;
	const iterations = Math.min(
		Math.max(Number(body.iterations) || DEFAULT_ITERATIONS, 100),
		MAX_ITERATIONS
	);
	if (!setCode || !boxType) throw error(400, 'setCode and boxType required');

	const boxConfig = getBoxConfig(boxType, setCode);
	if (!boxConfig) throw error(400, `No config for box=${boxType} set=${setCode}`);

	const snapshot = await loadSnapshot();
	const sources: SimulatorSources = {
		allCards: snapshot.allCards,
		priceLookup: (id: string) => snapshot.priceMap.get(id) ?? null,
	};

	const boxValues: number[] = [];
	const parallelCounts = new Map<string, number>();
	const topHitsPerBox: Array<{ heroName: string; cardNumber: string; parallel: string; price: number }> = [];
	let boxesHittingMsrp = 0;
	let boxesHittingJackpot = 0;
	const msrp = (boxConfig.msrpCents ?? 0) / 100;
	const JACKPOT_THRESHOLD = msrp * 2;

	let pricedCardsSeen = 0;
	let totalCardsSeen = 0;

	const simStartSeed = crypto.randomUUID();
	for (let i = 0; i < iterations; i++) {
		const packs: PackResult[] = openBox(
			boxConfig.slots,
			boxConfig.packsPerBox,
			setCode,
			boxConfig.guarantees,
			`${simStartSeed}-${i}`,
			sources
		);
		let boxValue = 0;
		let bestCard: (typeof topHitsPerBox)[number] | null = null;
		for (const p of packs) {
			boxValue += p.totalValue;
			for (const c of p.cards) {
				totalCardsSeen++;
				if (c.price != null) pricedCardsSeen++;
				if (c.parallel && c.parallel !== 'paper' && c.parallel !== 'base') {
					parallelCounts.set(c.parallel, (parallelCounts.get(c.parallel) ?? 0) + 1);
				}
				if (c.price != null && (!bestCard || c.price > bestCard.price)) {
					bestCard = {
						heroName: c.heroName,
						cardNumber: c.cardNumber,
						parallel: c.parallel,
						price: c.price,
					};
				}
			}
		}
		boxValues.push(boxValue);
		if (boxValue >= msrp) boxesHittingMsrp++;
		if (boxValue >= JACKPOT_THRESHOLD) boxesHittingJackpot++;
		if (bestCard) topHitsPerBox.push(bestCard);
	}

	boxValues.sort((a, b) => a - b);
	const pct = (p: number) =>
		boxValues[Math.min(Math.floor(boxValues.length * p), boxValues.length - 1)];
	const ev = boxValues.reduce((s, v) => s + v, 0) / boxValues.length;
	const median = pct(0.5);

	topHitsPerBox.sort((a, b) => b.price - a.price);
	const topHits = topHitsPerBox.slice(0, 10);

	const avgParallelsByType: Record<string, number> = {};
	for (const [parallel, count] of parallelCounts) {
		avgParallelsByType[parallel] = count / iterations;
	}

	return json({
		iterations,
		msrp,
		ev: Number(ev.toFixed(2)),
		median: Number(median.toFixed(2)),
		p10: Number(pct(0.1).toFixed(2)),
		p90: Number(pct(0.9).toFixed(2)),
		p99: Number(pct(0.99).toFixed(2)),
		max: Number(boxValues[boxValues.length - 1].toFixed(2)),
		breakEvenPct: Math.round((boxesHittingMsrp / iterations) * 100),
		jackpotPct: Math.round((boxesHittingJackpot / iterations) * 100),
		avgParallelsByType,
		topHits,
		priceCoverage: totalCardsSeen > 0 ? Math.round((pricedCardsSeen / totalCardsSeen) * 100) : 0,
		configLabel: boxConfig.displayName,
		setLabel: setCode,
	});
};
