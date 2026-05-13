/**
 * Seller detail page server load.
 *
 * Admin gating is provided by `/admin/+layout.server.ts` (requireAdmin) — every
 * request to this route runs that layout load first, so we don't repeat the
 * check here.
 *
 * Both views (`seller_listing_analytics`, `seller_listings_with_market_context`)
 * are service_role only.
 */

import { error } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { PageServerLoad } from './$types';

export interface SellerDetail {
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
	under_10_count: number;
	p10_50_count: number;
	p50_200_count: number;
	p200_plus_count: number;
	best_offer_listings: number;
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
	boba_listings: number;
	wonders_listings: number;
}

export interface SellerListing {
	ebay_item_id: string;
	card_id: string;
	card_name: string;
	card_number: string;
	parallel: string;
	game_id: string;
	weapon_type: string | null;
	ask_price: number;
	market_low: number | null;
	market_median: number | null;
	market_high: number | null;
	pct_vs_median: number | null;
	percentile_in_card: number | null;
	competitors: number;
	accepts_offers: boolean;
	condition_label: string | null;
	last_seen: string;
}

export const load: PageServerLoad = async ({ params }) => {
	const username = params.username;
	if (!username) throw error(404, 'Seller not found');

	const typedAdmin = getAdminClient();
	if (!typedAdmin) throw error(503, 'Admin client unavailable');
	const admin = typedAdmin as unknown as SupabaseClient;

	const sellerP = admin
		.from('seller_listing_analytics')
		.select('*')
		.eq('seller_username', username)
		.maybeSingle();

	const listingsP = admin
		.from('seller_listings_with_market_context')
		.select(
			[
				'ebay_item_id',
				'card_id',
				'card_name',
				'card_number',
				'parallel',
				'game_id',
				'weapon_type',
				'ask_price',
				'market_low',
				'market_median',
				'market_high',
				'pct_vs_median',
				'percentile_in_card',
				'competitors',
				'accepts_offers',
				'condition_label',
				'last_seen'
			].join(',')
		)
		.eq('seller_username', username)
		.order('ask_price', { ascending: false });

	const [sellerR, listingsR] = await Promise.all([sellerP, listingsP]);

	if (sellerR.error) throw error(500, sellerR.error.message);
	if (!sellerR.data) throw error(404, `Seller ${username} not in current 14-day window`);
	if (listingsR.error) throw error(500, listingsR.error.message);

	return {
		seller: sellerR.data as unknown as SellerDetail,
		listings: (listingsR.data ?? []) as unknown as SellerListing[]
	};
};
