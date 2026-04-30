import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSellerToken, isSellerConnected } from '$lib/server/ebay-seller-auth';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { parseJsonBody, requireString, requireAuth } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';
import { logEbayUsage } from '$lib/server/ebay-usage-log';

export const config = { maxDuration: 30 };

const EBAY_INVENTORY_URL = 'https://api.ebay.com/sell/inventory/v1';

/**
 * POST /api/ebay/end-listing
 * Ends an eBay listing by withdrawing the offer, then updates the DB.
 */
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const user = await requireAuth(locals);
	const clientIp = getClientAddress();
	const userAgent = request.headers.get('user-agent');

	const rl = await checkHeavyMutationRateLimit(user.id);
	if (!rl.success) return json({ error: 'Too many requests' }, { status: 429 });

	const adminClient = getAdminClient();
	if (!adminClient) throw error(500, 'Database unavailable');

	const body = await parseJsonBody(request);
	const listingId = requireString(body.listingId, 'listingId');

	const { data: listing, error: fetchErr } = await adminClient
		.from('listing_templates')
		.select('id, sku, ebay_offer_id, ebay_listing_id, status, user_id')
		.eq('id', listingId)
		.eq('user_id', user.id)
		.single();

	if (fetchErr || !listing) throw error(404, 'Listing not found');

	if (listing.status === 'ended' || listing.status === 'sold') {
		return json({ success: true, message: 'Listing already ended' });
	}

	const connected = await isSellerConnected(user.id);
	const token = connected ? await getSellerToken(user.id) : null;

	// Withdraw the offer on eBay
	let offerIdToWithdraw = listing.ebay_offer_id;

	// If no offer ID stored, try to find it by SKU
	if (!offerIdToWithdraw && listing.sku && token) {
		try {
			const lookupStart = Date.now();
			const lookupRes = await fetch(
				`${EBAY_INVENTORY_URL}/offer?sku=${encodeURIComponent(listing.sku)}&limit=1`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						'Accept-Language': 'en-US',
						'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
					}
				}
			);
			void logEbayUsage({
				userId: user.id,
				endpoint: 'sell.inventory.get_offers',
				httpMethod: 'GET',
				httpStatus: lookupRes.status,
				success: lookupRes.ok,
				errorMessage: lookupRes.ok ? null : `HTTP ${lookupRes.status}`,
				requestPath: '/api/ebay/end-listing',
				ipAddress: clientIp,
				userAgent,
				durationMs: Date.now() - lookupStart
			});
			if (lookupRes.ok) {
				const data = await lookupRes.json();
				offerIdToWithdraw = data.offers?.[0]?.offerId || null;
			}
		} catch { /* fall through */ }
	}

	if (offerIdToWithdraw && token) {
		try {
			const withdrawStart = Date.now();
			const res = await fetch(
				`${EBAY_INVENTORY_URL}/offer/${offerIdToWithdraw}/withdraw`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${token}`,
						'Accept-Language': 'en-US',
						'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
					}
				}
			);
			void logEbayUsage({
				userId: user.id,
				endpoint: 'sell.inventory.withdraw_offer',
				httpMethod: 'POST',
				httpStatus: res.status,
				success: res.ok,
				errorMessage: res.ok ? null : `HTTP ${res.status}`,
				requestPath: '/api/ebay/end-listing',
				ipAddress: clientIp,
				userAgent,
				durationMs: Date.now() - withdrawStart
			});
			if (!res.ok && res.status !== 404) {
				const errBody = await res.text().catch(() => '');
				console.error('[ebay/end-listing] Withdraw failed:', res.status, errBody);
			}
		} catch (err) {
			console.error('[ebay/end-listing] Withdraw request failed:', err);
		}
	}

	// Delete the inventory item
	if (listing.sku && token) {
		try {
			const deleteStart = Date.now();
			const deleteRes = await fetch(
				`${EBAY_INVENTORY_URL}/inventory_item/${encodeURIComponent(listing.sku)}`,
				{
					method: 'DELETE',
					headers: {
						Authorization: `Bearer ${token}`,
						'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
					}
				}
			);
			void logEbayUsage({
				userId: user.id,
				endpoint: 'sell.inventory.delete_item',
				httpMethod: 'DELETE',
				httpStatus: deleteRes.status,
				success: deleteRes.ok,
				errorMessage: deleteRes.ok ? null : `HTTP ${deleteRes.status}`,
				requestPath: '/api/ebay/end-listing',
				ipAddress: clientIp,
				userAgent,
				durationMs: Date.now() - deleteStart
			});
		} catch { /* non-critical */ }
	}

	await adminClient.from('listing_templates').update({
		status: 'ended',
		updated_at: new Date().toISOString()
	}).eq('id', listingId);

	return json({ success: true, message: 'Listing ended' });
};

/**
 * DELETE /api/ebay/end-listing
 * Removes a listing record from the app WITHOUT ending it on eBay.
 */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);

	const adminClient = getAdminClient();
	if (!adminClient) throw error(500, 'Database unavailable');

	const body = await parseJsonBody(request);
	const listingId = requireString(body.listingId, 'listingId');

	const { error: delErr } = await adminClient
		.from('listing_templates')
		.delete()
		.eq('id', listingId)
		.eq('user_id', user.id);

	if (delErr) {
		console.error('[ebay/end-listing] Delete failed:', delErr.message);
		throw error(500, 'Failed to remove listing');
	}

	return json({ success: true, message: 'Listing removed' });
};
