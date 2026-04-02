/**
 * GET /api/market/facets — Available filter values with counts
 *
 * Returns distinct values for each filterable dimension, with the count
 * of priced cards that have that value. Powers the filter dropdowns.
 *
 * Cached aggressively since facets change slowly (only when harvester runs).
 */

import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Sign in required');

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Database unavailable');

	// Get all card IDs that have pricing data
	const { data: pricedIds } = await admin
		.from('price_cache')
		.select('card_id')
		.eq('source', 'ebay')
		.not('price_mid', 'is', null)
		.limit(20000);

	const pricedSet = new Set((pricedIds || []).map((r: { card_id: string }) => r.card_id));

	// Fetch all cards with filterable attributes (lightweight — no joins)
	const { data: allCards } = await admin
		.from('cards')
		.select('id, parallel, weapon_type, set_code, rarity, hero_name, power')
		.limit(20000);

	if (!allCards) return json({ facets: {}, totalPriced: 0, totalCards: 0 });

	const cardRows = allCards;

	// Build facets from ALL cards (not just priced ones)
	function countBy(field: string): { value: string; count: number; pricedCount: number }[] {
		const counts: Record<string, { total: number; priced: number }> = {};
		for (const card of cardRows) {
			const val = (card as Record<string, unknown>)[field];
			if (val != null && val !== '') {
				const key = String(val);
				if (!counts[key]) counts[key] = { total: 0, priced: 0 };
				counts[key].total += 1;
				if (pricedSet.has((card as { id: string }).id)) {
					counts[key].priced += 1;
				}
			}
		}
		return Object.entries(counts)
			.map(([value, { total, priced }]) => ({ value, count: total, pricedCount: priced }))
			.sort((a, b) => b.count - a.count);
	}

	// Power ranges (bucket into 10-point ranges)
	const powerBuckets: Record<string, { total: number; priced: number }> = {};
	for (const card of cardRows) {
		const c = card as Record<string, unknown>;
		const power = c.power as number | null;
		if (power != null) {
			const bucket = Math.floor(power / 10) * 10;
			const label = `${bucket}\u2013${bucket + 9}`;
			if (!powerBuckets[label]) powerBuckets[label] = { total: 0, priced: 0 };
			powerBuckets[label].total += 1;
			if (pricedSet.has((card as { id: string }).id)) {
				powerBuckets[label].priced += 1;
			}
		}
	}

	return json({
		facets: {
			parallel: countBy('parallel'),
			weapon: countBy('weapon_type'),
			set: countBy('set_code'),
			rarity: countBy('rarity'),
			hero: countBy('hero_name'),
			power: Object.entries(powerBuckets)
				.map(([value, { total, priced }]) => ({ value, count: total, pricedCount: priced }))
				.sort((a, b) => parseInt(a.value) - parseInt(b.value)),
		},
		totalPriced: pricedSet.size,
		totalCards: cardRows.length,
	}, {
		headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=1200' }
	});
};
