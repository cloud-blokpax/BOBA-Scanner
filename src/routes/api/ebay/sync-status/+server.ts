import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSellerToken, isSellerConnected } from '$lib/server/ebay-seller-auth';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { requireAuth } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';
import { apiError, rateLimited, serviceUnavailable } from '$lib/server/api-response';
import { logEbayUsage } from '$lib/server/ebay-usage-log';

export const config = { maxDuration: 30 };

const EBAY_INVENTORY_URL = 'https://api.ebay.com/sell/inventory/v1';
const EBAY_FULFILLMENT_URL = 'https://api.ebay.com/sell/fulfillment/v1';

/**
 * POST /api/ebay/sync-status
 * Syncs listing status from eBay for all active listings.
 *
 * Uses Inventory API to check offer status (works with current scopes).
 * If fulfillment scope is available, also checks for sold orders.
 */
export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	const user = await requireAuth(locals);
	const clientIp = getClientAddress();
	const userAgent = request.headers.get('user-agent');

	const rl = await checkHeavyMutationRateLimit(user.id);
	if (!rl.success) return rateLimited(rl);

	const adminClient = getAdminClient();
	if (!adminClient) return serviceUnavailable('Database');

	const connected = await isSellerConnected(user.id);
	if (!connected) {
		return apiError('eBay account not connected', 403);
	}

	const token = await getSellerToken(user.id);
	if (!token) {
		return apiError('eBay session expired. Reconnect in Settings.', 403);
	}

	// Get all active listings (draft or published, not yet sold/ended/error)
	const { data: activeListings, error: queryErr } = await adminClient
		.from('listing_templates')
		.select('id, sku, status, ebay_offer_id, ebay_listing_id')
		.eq('user_id', user.id)
		.in('status', ['draft', 'published', 'pending'])
		.limit(50);

	if (queryErr) {
		console.error('[ebay/sync-status] Query failed:', queryErr.message);
		return apiError('Failed to load listings', 500);
	}

	if (!activeListings || activeListings.length === 0) {
		return json({ updated: 0, message: 'No active listings to sync' });
	}

	const ebayHeaders = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		'Accept-Language': 'en-US',
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
	};

	let updated = 0;

	// Check offer status via Inventory API for listings with offer IDs
	const listingsWithOffers = activeListings.filter(l => l.ebay_offer_id);
	for (const listing of listingsWithOffers) {
		try {
			const offerCheckStart = Date.now();
			const res = await fetch(
				`${EBAY_INVENTORY_URL}/offer/${listing.ebay_offer_id}`,
				{ headers: ebayHeaders }
			);
			void logEbayUsage({
				userId: user.id,
				endpoint: 'sell.inventory.get_offer',
				httpMethod: 'GET',
				httpStatus: res.status,
				success: res.ok,
				errorMessage: res.ok ? null : `HTTP ${res.status}`,
				requestPath: '/api/ebay/sync-status',
				ipAddress: clientIp,
				userAgent,
				durationMs: Date.now() - offerCheckStart
			});

			if (!res.ok) {
				if (res.status === 404) {
					// Offer no longer exists — mark as ended
					await adminClient.from('listing_templates').update({
						status: 'ended',
						updated_at: new Date().toISOString()
					}).eq('id', listing.id);
					updated++;
				}
				continue;
			}

			const offer = await res.json();
			const offerStatus = offer.status; // PUBLISHED, ENDED, etc.

			if (offerStatus === 'ENDED') {
				await adminClient.from('listing_templates').update({
					status: 'ended',
					updated_at: new Date().toISOString()
				}).eq('id', listing.id);
				updated++;
			} else if (offerStatus === 'PUBLISHED' && listing.status !== 'published') {
				await adminClient.from('listing_templates').update({
					status: 'published',
					ebay_listing_url: offer.listing?.listingId
						? `https://www.ebay.com/itm/${offer.listing.listingId}`
						: null,
					ebay_listing_id: offer.listing?.listingId || listing.ebay_listing_id,
					updated_at: new Date().toISOString()
				}).eq('id', listing.id);
				updated++;
			}
		} catch (err) {
			console.debug('[ebay/sync-status] Offer check failed for', listing.sku, err);
		}
	}

	// Check for inventory items without offers (partial drafts)
	const listingsWithoutOffers = activeListings.filter(l => !l.ebay_offer_id && l.sku);
	for (const listing of listingsWithoutOffers) {
		try {
			const invCheckStart = Date.now();
			const res = await fetch(
				`${EBAY_INVENTORY_URL}/inventory_item/${encodeURIComponent(listing.sku)}`,
				{ headers: ebayHeaders }
			);
			void logEbayUsage({
				userId: user.id,
				endpoint: 'sell.inventory.get_item',
				httpMethod: 'GET',
				httpStatus: res.status,
				success: res.ok || res.status === 404,
				errorMessage: res.ok || res.status === 404 ? null : `HTTP ${res.status}`,
				requestPath: '/api/ebay/sync-status',
				ipAddress: clientIp,
				userAgent,
				durationMs: Date.now() - invCheckStart
			});

			if (res.status === 404) {
				// Inventory item no longer exists
				await adminClient.from('listing_templates').update({
					status: 'ended',
					updated_at: new Date().toISOString()
				}).eq('id', listing.id);
				updated++;
			}
			// If inventory item exists but no offer, keep as draft
		} catch (err) {
			console.debug('[ebay/sync-status] Inventory check failed for', listing.sku, err);
		}
	}

	// Check fulfillment API for sold orders (if scope available)
	const hasFulfillmentScope = await checkFulfillmentScope(user.id, adminClient);
	let soldCount = 0;

	if (hasFulfillmentScope) {
		try {
			// Find listings that just changed to 'ended' — check if they were sold
			const endedSkus = activeListings
				.filter(l => l.ebay_listing_id)
				.map(l => l.ebay_listing_id!);

			if (endedSkus.length > 0) {
				// Check recent orders (last 30 days)
				const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
				const orderStart = Date.now();
				const orderRes = await fetch(
					`${EBAY_FULFILLMENT_URL}/order?filter=creationdate:[${since}..]&limit=50`,
					{ headers: ebayHeaders }
				);
				void logEbayUsage({
					userId: user.id,
					endpoint: 'sell.fulfillment.get_orders',
					httpMethod: 'GET',
					httpStatus: orderRes.status,
					success: orderRes.ok,
					errorMessage: orderRes.ok ? null : `HTTP ${orderRes.status}`,
					requestPath: '/api/ebay/sync-status',
					ipAddress: clientIp,
					userAgent,
					durationMs: Date.now() - orderStart
				});

				if (orderRes.ok) {
					const orderData = await orderRes.json();
					const orders = orderData.orders || [];

					for (const order of orders) {
						const lineItems = order.lineItems || [];
						for (const item of lineItems) {
							const legacyItemId = item.legacyItemId;
							// Match by eBay listing ID
							const matchedListing = activeListings.find(l => l.ebay_listing_id === legacyItemId);
							if (matchedListing) {
								const totalPrice = parseFloat(item.total?.value || order.pricingSummary?.total?.value || '0');
								await adminClient.from('listing_templates').update({
									status: 'sold',
									sold_at: order.creationDate || new Date().toISOString(),
									sold_price: totalPrice || null,
									updated_at: new Date().toISOString()
								}).eq('id', matchedListing.id);
								soldCount++;
								updated++;
							}
						}
					}
				}
			}
		} catch (err) {
			console.debug('[ebay/sync-status] Fulfillment check failed:', err);
		}
	}

	return json({
		updated,
		sold: soldCount,
		checked: activeListings.length,
		hasFulfillmentScope,
		message: updated > 0
			? `Updated ${updated} listing${updated !== 1 ? 's' : ''}${soldCount > 0 ? ` (${soldCount} sold)` : ''}`
			: 'All listings are up to date'
	});
};

async function checkFulfillmentScope(
	userId: string,
	adminClient: NonNullable<ReturnType<typeof getAdminClient>>
): Promise<boolean> {
	const { data } = await adminClient
		.from('ebay_seller_tokens')
		.select('scopes')
		.eq('user_id', userId)
		.maybeSingle();

	if (!data?.scopes) return false;
	return data.scopes.includes('sell.fulfillment');
}
