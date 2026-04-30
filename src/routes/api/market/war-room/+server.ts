/**
 * GET /api/market/war-room — Live data for the War Room dashboard
 *
 * Returns heroes and plays with current pricing from price_cache,
 * replacing the previously hardcoded war-room-data.ts arrays.
 */

import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database unavailable');

	// Paginate all large tables in 1k chunks (Supabase caps at 1,000 rows).
	const CHUNK = 1000;

	// Fetch hero cards with pricing via two-query approach
	// (avoids PostgREST LEFT JOIN issues with large tables)
	const [priceData, cardData, playPriceData, playCardRes] = await Promise.all([
		// price_cache for heroes — paginated
		(async () => {
			const rows: Array<Record<string, unknown>> = [];
			let offset = 0;
			let done = false;
			while (!done) {
				const { data } = await admin
					.from('price_cache')
					.select('card_id, price_low, price_mid, price_high, buy_now_low, buy_now_mid, buy_now_count, listings_count, filtered_count, confidence_score, fetched_at')
					.eq('source', 'ebay')
					.not('price_mid', 'is', null)
					.order('price_mid', { ascending: false })
					.range(offset, offset + CHUNK - 1);
				if (!data || data.length === 0) { done = true; }
				else { rows.push(...data); offset += CHUNK; if (data.length < CHUNK) done = true; }
			}
			return rows;
		})(),
		// cards — paginated (War Room is BoBA-only by design)
		(async () => {
			const rows: Array<Record<string, unknown>> = [];
			let offset = 0;
			let done = false;
			while (!done) {
				const { data } = await admin
					.from('cards')
					.select('id, hero_name, name, card_number, set_code, power, rarity, weapon_type, parallel, athlete_name')
					.eq('game_id', 'boba')
					.range(offset, offset + CHUNK - 1);
				if (!data || data.length === 0) { done = true; }
				else { rows.push(...data); offset += CHUNK; if (data.length < CHUNK) done = true; }
			}
			return rows;
		})(),
		// Play card prices live in play_price_cache (TEXT card_id), not price_cache (UUID).
		// With ~409 play cards, no pagination needed.
		(async (): Promise<Array<Record<string, unknown>>> => {
			const { data } = await admin
				.from('play_price_cache')
				.select('card_id, price_low, price_mid, price_high, buy_now_low, buy_now_mid, buy_now_count, listings_count, filtered_count, confidence_score, fetched_at')
				.eq('source', 'ebay')
				.not('price_mid', 'is', null);
			return (data || []) as Array<Record<string, unknown>>;
		})(),
		admin
			.from('play_cards')
			.select('id, name, card_number, release, dbs, hot_dog_cost')
			.limit(1000),
	]);

	if (playCardRes.error) {
		console.error('[war-room] Play card query failed:', playCardRes.error);
	}

	// Build card lookup
	const cardMap = new Map(cardData.map(c => [String(c.id), c]));

	// Merge heroes: iterate price rows (already sorted by price desc), match to cards
	const heroes = priceData
		.filter(pr => cardMap.has(String(pr.card_id)))
		.map(pr => {
			const card = cardMap.get(String(pr.card_id))!;
			const mid = Number(pr.price_mid ?? 0);
			const pwr = Number(card.power ?? 0);
			const bn = pr.buy_now_mid != null ? Number(pr.buy_now_mid) : mid;
			const ls = Number(pr.listings_count ?? 0);
			const bnC = Number(pr.buy_now_count ?? 0);
			const cf = Number(pr.confidence_score ?? 0);

			return {
				hero: card.hero_name || card.name || 'Unknown',
				num: card.card_number || '',
				p: card.parallel || 'Paper',
				w: card.weapon_type || '',
				pwr,
				s: card.set_code || '',
				ath: card.athlete_name || '',
				mid,
				bn,
				ls,
				bnC,
				cf,
				ppp: pwr > 0 ? Math.round((mid / pwr) * 1000) / 1000 : 0,
			};
		});

	// Play card prices come from play_price_cache (fetched in parallel above).
	// playPriceData is the result of the play_price_cache query.
	const playPriceMap = new Map(
		playPriceData
			.map(p => [String(p.card_id), p])
	);

	const plays = (playCardRes.data || [])
		.filter(pc => playPriceMap.has(String(pc.id)))
		.map(pc => {
			const price = playPriceMap.get(String(pc.id))!;
			const mid = Number(price.price_mid ?? 0);
			const dbs = Number((pc as Record<string, unknown>).dbs ?? 0);
			return {
				name: (pc as Record<string, unknown>).name || 'Unknown',
				num: (pc as Record<string, unknown>).card_number || '',
				dbs,
				hd: Number((pc as Record<string, unknown>).hot_dog_cost ?? 0),
				mid,
				bn: price.buy_now_mid != null ? Number(price.buy_now_mid) : mid,
				ls: Number(price.listings_count ?? 0),
				cf: Number(price.confidence_score ?? 0),
				r: '',
				dpd: dbs > 0 ? Math.round((mid / dbs) * 100) / 100 : null,
			};
		})
		.sort((a, b) => b.mid - a.mid);

	return json({ heroes, plays }, {
		headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' }
	});
};
