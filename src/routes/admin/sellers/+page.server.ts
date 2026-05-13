/**
 * Seller analytics admin page server load.
 *
 * Admin gating is provided by `/admin/+layout.server.ts` (requireAdmin) — every
 * request to this route runs that layout load first, so we don't repeat the
 * check here.
 *
 * Both data sources are materialized views populated by the canonical
 * attribution refresh chain — `seller_listing_analytics` and
 * `seller_listings_with_market_context`. Both have SELECT granted to
 * service_role only, so we must use the admin client.
 */

import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { PageServerLoad } from './$types';

const SORT_FIELDS = new Set([
	'total_ask_usd',
	'unique_listings',
	'days_seen_active',
	'feedback_score',
	'avg_percentile',
	'median_ask'
]);

const PRICING_ARCHETYPES = new Set([
	'all',
	'undercutter',
	'premium_asker',
	'mixed_strategy',
	'mid_competitive',
	'mid_premium',
	'insufficient_data'
]);

const INVENTORY_ARCHETYPES = new Set([
	'all',
	'high_volume_dealer',
	'large_inventory',
	'mid_inventory',
	'small_inventory',
	'casual'
]);

export interface SellerRow {
	seller_username: string;
	feedback_score: number | null;
	feedback_pct: number | null;
	unique_listings: number;
	distinct_cards: number;
	listings_per_card: number | null;
	total_ask_usd: number | null;
	avg_ask: number | null;
	median_ask: number | null;
	cheapest: number | null;
	priciest: number | null;
	best_offer_pct: number | null;
	competitive_listings: number;
	avg_percentile: number | null;
	percentile_stddev: number | null;
	in_bottom_quartile: number;
	in_middle_half: number;
	in_top_quartile: number;
	pricing_archetype: string;
	inventory_archetype: string;
	days_seen_active: number;
	last_seen: string;
	boba_listings: number;
	wonders_listings: number;
}

export interface DealRow {
	seller_username: string;
	card_id: string;
	card_name: string;
	card_number: string;
	parallel: string;
	game_id: string;
	ask_price: number;
	market_low: number | null;
	market_median: number | null;
	market_high: number | null;
	pct_vs_median: number | null;
	competitors: number;
	accepts_offers: boolean;
	ebay_item_id: string;
	condition_label: string | null;
	last_seen: string;
}

export const load: PageServerLoad = async ({ url }) => {
	const sortField = url.searchParams.get('sort') ?? 'total_ask_usd';
	const sortBy = SORT_FIELDS.has(sortField) ? sortField : 'total_ask_usd';
	const archetype = url.searchParams.get('archetype') ?? 'all';
	const archetypeFilter = PRICING_ARCHETYPES.has(archetype) ? archetype : 'all';
	const inventory = url.searchParams.get('inventory') ?? 'all';
	const inventoryFilter = INVENTORY_ARCHETYPES.has(inventory) ? inventory : 'all';
	const minListings = Math.max(1, Number(url.searchParams.get('min_listings') ?? '5') || 5);
	const search = (url.searchParams.get('q') ?? '').trim();

	const typedAdmin = getAdminClient();
	if (!typedAdmin) throw error(503, 'Admin client unavailable');

	// Database type doesn't include materialized views (Views: Record<string, never>),
	// so we cast to an untyped client to query them.
	const admin = typedAdmin as unknown as SupabaseClient;

	const SELLER_COLUMNS = [
		'seller_username',
		'feedback_score',
		'feedback_pct',
		'unique_listings',
		'distinct_cards',
		'listings_per_card',
		'total_ask_usd',
		'avg_ask',
		'median_ask',
		'cheapest',
		'priciest',
		'best_offer_pct',
		'competitive_listings',
		'avg_percentile',
		'percentile_stddev',
		'in_bottom_quartile',
		'in_middle_half',
		'in_top_quartile',
		'pricing_archetype',
		'inventory_archetype',
		'days_seen_active',
		'last_seen',
		'boba_listings',
		'wonders_listings'
	].join(',');

	let sellersQuery = admin
		.from('seller_listing_analytics')
		.select(SELLER_COLUMNS)
		.gte('unique_listings', minListings)
		.order(sortBy, { ascending: false, nullsFirst: false })
		.limit(100);

	if (archetypeFilter !== 'all') {
		sellersQuery = sellersQuery.eq('pricing_archetype', archetypeFilter);
	}
	if (inventoryFilter !== 'all') {
		sellersQuery = sellersQuery.eq('inventory_archetype', inventoryFilter);
	}
	if (search.length >= 2) {
		// Escape PostgREST ilike wildcards to prevent caller-controlled pattern matching.
		const escaped = search.replace(/[\\%_]/g, (m) => `\\${m}`);
		sellersQuery = sellersQuery.ilike('seller_username', `%${escaped}%`);
	}

	const statsQuery = admin
		.from('seller_listing_analytics')
		.select('total_ask_usd, unique_listings');

	const dealsQuery = admin
		.from('seller_listings_with_market_context')
		.select(
			[
				'seller_username',
				'card_id',
				'card_name',
				'card_number',
				'parallel',
				'game_id',
				'ask_price',
				'market_low',
				'market_median',
				'market_high',
				'pct_vs_median',
				'competitors',
				'accepts_offers',
				'ebay_item_id',
				'condition_label',
				'last_seen'
			].join(',')
		)
		.gte('competitors', 3)
		.gte('market_median', 25)
		.lte('pct_vs_median', -50)
		.order('pct_vs_median', { ascending: true })
		.limit(25);

	const [sellersR, statsR, dealsR] = await Promise.all([sellersQuery, statsQuery, dealsQuery]);

	if (sellersR.error) throw error(500, `Sellers query failed: ${sellersR.error.message}`);
	if (statsR.error) throw error(500, `Stats query failed: ${statsR.error.message}`);
	if (dealsR.error) throw error(500, `Deals query failed: ${dealsR.error.message}`);

	const statsRows = (statsR.data ?? []) as Array<{
		total_ask_usd: number | null;
		unique_listings: number | null;
	}>;
	const totalSellers = statsRows.length;
	const totalAskVolume = statsRows.reduce((s, r) => s + Number(r.total_ask_usd ?? 0), 0);
	const totalListings = statsRows.reduce((s, r) => s + Number(r.unique_listings ?? 0), 0);

	return {
		sellers: (sellersR.data ?? []) as unknown as SellerRow[],
		deals: (dealsR.data ?? []) as unknown as DealRow[],
		stats: { totalSellers, totalAskVolume, totalListings },
		filters: {
			sortBy,
			archetype: archetypeFilter,
			inventory: inventoryFilter,
			minListings,
			search
		}
	};
};
