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

	try {
		// Use select('*') to avoid 500s when the DB schema doesn't yet have
		// every column the TypeScript types declare (e.g. ebay_offer_id, sold_at).
		let query = adminClient
			.from('listing_templates')
			.select('*')
			.eq('user_id', user.id)
			.order('created_at', { ascending: false })
			.limit(100);

		if (statusFilter !== 'all') {
			query = query.eq('status', statusFilter);
		}

		const { data: listings, error: listErr } = await query;

		if (listErr) {
			console.error('[ebay/listings] Query failed:', listErr.message, listErr.details, listErr.hint);
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

		// Build response with safe field access for columns that may not exist yet
		const enrichedListings = (listings || []).map(l => ({
			id: l.id,
			card_id: l.card_id,
			title: l.title,
			description: l.description ?? null,
			price: l.price,
			condition: l.condition ?? null,
			sku: l.sku,
			status: l.status,
			ebay_listing_id: l.ebay_listing_id ?? null,
			ebay_listing_url: l.ebay_listing_url ?? null,
			error_message: l.error_message ?? null,
			scan_image_url: l.scan_image_url ?? null,
			hero_name: l.hero_name ?? null,
			card_number: l.card_number ?? null,
			set_code: l.set_code ?? null,
			parallel: l.parallel ?? null,
			weapon_type: l.weapon_type ?? null,
			sold_at: l.sold_at ?? null,
			sold_price: l.sold_price ?? null,
			ebay_offer_id: l.ebay_offer_id ?? null,
			created_at: l.created_at,
			updated_at: l.updated_at ?? null,
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
				.reduce((sum, l) => sum + ((l.sold_price ?? l.price ?? 0) as number), 0)
		};

		return json({ listings: enrichedListings, summary });
	} catch (err) {
		// Re-throw SvelteKit HttpErrors (401, 403, etc.) as-is
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[ebay/listings] Unexpected error:', err);
		return apiError('Failed to load listings', 500);
	}
};
