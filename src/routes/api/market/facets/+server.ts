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
		.not('price_mid', 'is', null);

	const idSet = new Set((pricedIds || []).map((r: { card_id: string }) => r.card_id));

	// Fetch all cards with filterable attributes (lightweight — no joins)
	const { data: allCards } = await admin
		.from('cards')
		.select('id, parallel, weapon_type, set_code, rarity, hero_name, power');

	if (!allCards) return json({ facets: {}, totalPriced: 0, totalCards: 0 });

	// Only count cards that have pricing
	const priced = allCards.filter((c: { id: string }) => idSet.has(c.id));

	// Build facets — count distinct values per dimension
	function countBy(field: string): { value: string; count: number }[] {
		const counts: Record<string, number> = {};
		for (const card of priced) {
			const val = (card as Record<string, unknown>)[field];
			if (val != null && val !== '') {
				const key = String(val);
				counts[key] = (counts[key] || 0) + 1;
			}
		}
		return Object.entries(counts)
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => b.count - a.count);
	}

	// Power ranges (bucket into 10-point ranges)
	const powerBuckets: Record<string, number> = {};
	for (const card of priced) {
		const power = (card as Record<string, unknown>).power as number | null;
		if (power != null) {
			const bucket = Math.floor(power / 10) * 10;
			const label = `${bucket}\u2013${bucket + 9}`;
			powerBuckets[label] = (powerBuckets[label] || 0) + 1;
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
				.map(([value, count]) => ({ value, count }))
				.sort((a, b) => parseInt(a.value) - parseInt(b.value)),
		},
		totalPriced: priced.length,
		totalCards: allCards.length,
	}, {
		headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=1200' }
	});
};
