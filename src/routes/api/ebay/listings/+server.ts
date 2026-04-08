import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuth } from '$lib/server/validate';
import { checkCollectionRateLimit } from '$lib/server/rate-limit';
import { getAdminClient } from '$lib/server/supabase-admin';
import { apiError, rateLimited, serviceUnavailable } from '$lib/server/api-response';

/**
 * GET /api/ebay/listings
 * Returns the user's eBay listing history from listing_templates,
 * with card image fallback from the cards table.
 *
 * Query params:
 *   status - filter by status: all | draft | published | sold | ended | error (default: all)
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireAuth(locals);

	const rl = await checkCollectionRateLimit(user.id);
	if (!rl.success) return rateLimited(rl);

	const adminClient = getAdminClient();
	if (!adminClient) return serviceUnavailable('Database');

	const statusFilter = url.searchParams.get('status') || 'all';
	const validStatuses = ['all', 'draft', 'published', 'sold', 'ended', 'error', 'pending'];

	if (!validStatuses.includes(statusFilter)) {
		return apiError('Invalid status filter', 400);
	}

	let query = adminClient
		.from('listing_templates')
		.select('id, card_id, title, description, price, condition, sku, status, ebay_listing_id, ebay_listing_url, error_message, scan_image_url, hero_name, card_number, set_code, parallel, weapon_type, sold_at, sold_price, ebay_offer_id, created_at, updated_at')
		.eq('user_id', user.id)
		.order('created_at', { ascending: false })
		.limit(100);

	if (statusFilter !== 'all') {
		query = query.eq('status', statusFilter);
	}

	const { data: listings, error: listErr } = await query;

	if (listErr) {
		console.error('[ebay/listings] Query failed:', listErr.message);
		return apiError('Failed to load listings', 500);
	}

	// Fetch card image URLs as fallback for listings without scan images
	const cardIds = [...new Set((listings || []).map(l => l.card_id).filter(Boolean))];
	let cardImages: Record<string, string> = {};

	if (cardIds.length > 0) {
		const { data: cards } = await adminClient
			.from('cards')
			.select('id, image_url')
			.in('id', cardIds);

		if (cards) {
			cardImages = Object.fromEntries(
				cards.filter(c => c.image_url).map(c => [c.id, c.image_url!])
			);
		}
	}

	// Build response with card image fallback
	const enrichedListings = (listings || []).map(l => ({
		...l,
		card_image_url: cardImages[l.card_id] || null
	}));

	// Compute summary stats
	const all = listings || [];
	const summary = {
		total: all.length,
		active: all.filter(l => l.status === 'published' || l.status === 'draft').length,
		sold: all.filter(l => l.status === 'sold').length,
		revenue: all
			.filter(l => l.status === 'sold')
			.reduce((sum, l) => sum + (l.sold_price ?? l.price ?? 0), 0)
	};

	return json({ listings: enrichedListings, summary });
};
