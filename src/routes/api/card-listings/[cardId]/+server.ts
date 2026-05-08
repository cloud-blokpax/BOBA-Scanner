/**
 * GET /api/card-listings/[cardId] — recent comparable eBay listings for a card.
 *
 * Reads via admin client because the source table (ebay_listing_observations)
 * is admin-RLS. The RPC itself is SECURITY DEFINER and only returns
 * whitelisted columns, so even a future role-grants regression wouldn't leak
 * raw observation rows.
 *
 * Public endpoint (no auth gate) — anyone with a card_id can see comparable
 * listings. Light rate limiting via existing global limiter in hooks.server.ts.
 *
 * Response is HTTP-cacheable for 5 minutes — listings don't change second-by-
 * second, and the eventual stale picture is fine for a comparable panel.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { getAdminClient } from '$lib/server/supabase-admin';
import { apiError, serviceUnavailable } from '$lib/server/api-response';

export const config = { maxDuration: 10 };

interface CardListingRow {
	ebay_item_id: string;
	title: string;
	price_value: number | null;
	condition_label: string | null;
	image_url: string | null;
	item_affiliate_url: string | null;
	item_web_url: string | null;
	seller_username: string | null;
	seller_feedback_pct: number | null;
	observed_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: RequestHandler = async ({ params, url }) => {
	const cardId = params.cardId;
	if (!cardId || !UUID_RE.test(cardId)) {
		return apiError('invalid card_id', 400);
	}

	const limitParam = url.searchParams.get('limit');
	const limit = Math.min(Math.max(Number(limitParam ?? '8') || 8, 1), 20);

	const admin = getAdminClient();
	if (!admin) return serviceUnavailable('Database');

	const { data, error: rpcError } = await (
		admin.rpc as unknown as (
			name: 'get_card_listings',
			args: { p_card_id: string; p_limit: number }
		) => Promise<{ data: CardListingRow[] | null; error: { message: string } | null }>
	)('get_card_listings', { p_card_id: cardId, p_limit: limit });

	if (rpcError) {
		console.error('[card-listings] RPC failed:', rpcError.message, { cardId });
		return apiError('failed to load listings', 500);
	}

	const rows = data ?? [];

	return json(
		{ listings: rows, count: rows.length },
		{
			headers: {
				// 5-minute browser cache + 5-minute CDN cache. Listings don't
				// change minute-to-minute and a stale picture is fine here.
				'Cache-Control': 'public, max-age=300, s-maxage=300'
			}
		}
	);
};
