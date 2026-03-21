import { json, error } from '@sveltejs/kit';
import { getSellerToken, isSellerConnected } from '$lib/server/ebay-seller-auth';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createClient } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

const EBAY_INVENTORY_URL = 'https://api.ebay.com/sell/inventory/v1';
const EBAY_ACCOUNT_URL = 'https://api.ebay.com/sell/account/v1';
const EBAY_CATEGORY_TRADING_CARDS = '183454';

/**
 * Fetch the seller's default business policies from eBay Account API.
 * Returns null if policies couldn't be fetched.
 */
async function getSellerPolicies(token: string): Promise<{
	fulfillmentPolicyId: string;
	paymentPolicyId: string;
	returnPolicyId: string;
} | null> {
	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
	};

	try {
		const [fulfillment, payment, returns] = await Promise.all([
			fetch(`${EBAY_ACCOUNT_URL}/fulfillment_policy?marketplace_id=EBAY_US`, { headers }).then(r => r.json()),
			fetch(`${EBAY_ACCOUNT_URL}/payment_policy?marketplace_id=EBAY_US`, { headers }).then(r => r.json()),
			fetch(`${EBAY_ACCOUNT_URL}/return_policy?marketplace_id=EBAY_US`, { headers }).then(r => r.json())
		]);

		const findPolicy = (policies: Array<Record<string, string>>, idField: string) => {
			if (!Array.isArray(policies) || policies.length === 0) return null;
			return policies[0][idField] || null;
		};

		const fulfillmentId = findPolicy(fulfillment.fulfillmentPolicies, 'fulfillmentPolicyId');
		const paymentId = findPolicy(payment.paymentPolicies, 'paymentPolicyId');
		const returnId = findPolicy(returns.returnPolicies, 'returnPolicyId');

		if (!fulfillmentId || !paymentId || !returnId) return null;

		return {
			fulfillmentPolicyId: fulfillmentId,
			paymentPolicyId: paymentId,
			returnPolicyId: returnId
		};
	} catch {
		return null;
	}
}

const CONDITION_MAP: Record<string, { conditionId: string; conditionDescription: string }> = {
	'Mint': { conditionId: '1000', conditionDescription: 'Brand New' },
	'Near Mint': { conditionId: '1000', conditionDescription: 'Near Mint condition' },
	'Excellent': { conditionId: '1500', conditionDescription: 'Like New, minimal wear' },
	'Good': { conditionId: '2000', conditionDescription: 'Good condition, light play wear' },
	'Fair': { conditionId: '2500', conditionDescription: 'Acceptable condition, visible wear' },
	'Poor': { conditionId: '3000', conditionDescription: 'Heavily played condition' }
};

function getServiceClient() {
	const url = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
	if (!url || !serviceKey) return null;
	return createClient(url, serviceKey);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'Authentication required');

	// Server-side feature gate
	if (locals.supabase) {
		const { data: profile } = await locals.supabase.from('users').select('is_member, is_admin').eq('id', user.id).single();
		const { data: override } = await locals.supabase.from('user_feature_overrides').select('enabled').eq('user_id', user.id).eq('feature_key', 'scan_to_list').maybeSingle();
		if (override) {
			if (!override.enabled) throw error(403, 'Feature not available');
		} else if (!profile?.is_member && !profile?.is_admin) {
			throw error(403, 'Premium feature — upgrade to access Scan-to-List');
		}
	}

	const connected = await isSellerConnected(user.id);
	if (!connected) throw error(403, 'eBay account not connected. Please connect your eBay seller account in Settings.');

	const body = await request.json();
	const { card_id, title, description, price, condition = 'Near Mint' } = body;

	if (!card_id || !title || !price) throw error(400, 'Missing required fields: card_id, title, price');
	if (typeof price !== 'number' || price <= 0) throw error(400, 'Price must be a positive number');

	const token = await getSellerToken(user.id);
	if (!token) throw error(403, 'eBay session expired. Please reconnect your eBay account.');

	const sku = `boba-${card_id}-${Date.now()}`;
	const conditionInfo = CONDITION_MAP[condition] || CONDITION_MAP['Near Mint'];

	const adminClient = getServiceClient();

	// Save template record (pending state)
	if (adminClient) {
		try {
			await adminClient.from('listing_templates').insert({
				user_id: user.id,
				card_id,
				title,
				description,
				price,
				condition,
				sku,
				status: 'pending',
				created_at: new Date().toISOString()
			});
		} catch {
			// Non-critical
		}
	}

	try {
		// Step 1: Create inventory item
		const inventoryRes = await fetch(`${EBAY_INVENTORY_URL}/inventory_item/${sku}`, {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Content-Language': 'en-US'
			},
			body: JSON.stringify({
				product: {
					title,
					description,
					aspects: {
						'Card Game': ['Bo Jackson Battle Arena'],
						'Card Condition': [condition]
					}
				},
				condition: conditionInfo.conditionId,
				conditionDescription: conditionInfo.conditionDescription,
				availability: {
					shipToLocationAvailability: {
						quantity: 1
					}
				}
			})
		});

		if (!inventoryRes.ok) {
			const errData = await inventoryRes.json().catch(() => ({}));
			const errMsg = errData?.errors?.[0]?.message || `Inventory item creation failed: ${inventoryRes.status}`;
			throw new Error(errMsg);
		}

		// Fetch seller's business policies
		const policies = await getSellerPolicies(token);
		if (!policies) {
			throw new Error(
				'No business policies found. Please set up shipping, payment, and return policies in eBay Seller Hub (https://www.ebay.com/sh/selling) before creating listings.'
			);
		}

		// Step 2: Create offer
		const offerRes = await fetch(`${EBAY_INVENTORY_URL}/offer`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Content-Language': 'en-US'
			},
			body: JSON.stringify({
				sku,
				marketplaceId: 'EBAY_US',
				format: 'FIXED_PRICE',
				listingDescription: description,
				availableQuantity: 1,
				categoryId: EBAY_CATEGORY_TRADING_CARDS,
				pricingSummary: {
					price: {
						value: price.toFixed(2),
						currency: 'USD'
					}
				},
				listingPolicies: {
					fulfillmentPolicyId: policies.fulfillmentPolicyId,
					paymentPolicyId: policies.paymentPolicyId,
					returnPolicyId: policies.returnPolicyId
				}
			})
		});

		if (!offerRes.ok) {
			const errData = await offerRes.json().catch(() => ({}));
			const errorId = errData?.errors?.[0]?.errorId;
			let errMsg = errData?.errors?.[0]?.message || `Offer creation failed: ${offerRes.status}`;

			if (errorId === 25710) {
				errMsg = 'Missing business policies. Please set up shipping, payment, and return policies in eBay Seller Hub before creating listings.';
			} else if (errorId === 25002) {
				errMsg = 'Missing inventory location. Please set up a business location in eBay Seller Hub before creating listings.';
			}

			throw new Error(errMsg);
		}

		let offerData;
		try {
			offerData = await offerRes.json();
		} catch {
			throw new Error('Invalid response from eBay offer API');
		}
		const offerId = offerData.offerId;
		if (!offerId) {
			throw new Error('eBay API did not return an offer ID');
		}

		// Step 3: Publish offer
		const publishRes = await fetch(`${EBAY_INVENTORY_URL}/offer/${offerId}/publish`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json'
			}
		});

		if (!publishRes.ok) {
			const errData = await publishRes.json().catch(() => ({}));
			const errMsg = errData?.errors?.[0]?.message || `Publish failed: ${publishRes.status}`;
			throw new Error(errMsg);
		}

		let publishData;
		try {
			publishData = await publishRes.json();
		} catch {
			throw new Error('Invalid response from eBay publish API');
		}
		const listingId = publishData.listingId;
		if (!listingId) {
			throw new Error('eBay API did not return a listing ID');
		}
		const listingUrl = `https://www.ebay.com/itm/${listingId}`;

		// Update template with success
		if (adminClient) {
			try {
				await adminClient.from('listing_templates').update({
					status: 'published',
					ebay_listing_id: listingId,
					ebay_listing_url: listingUrl,
					updated_at: new Date().toISOString()
				}).eq('sku', sku);
			} catch {
				// Non-critical
			}
		}

		return json({
			success: true,
			listing_id: listingId,
			listing_url: listingUrl,
			sku
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Listing creation failed';

		// Update template with error
		if (adminClient) {
			try {
				await adminClient.from('listing_templates').update({
					status: 'error',
					error_message: message,
					updated_at: new Date().toISOString()
				}).eq('sku', sku);
			} catch {
				// Non-critical
			}
		}

		throw error(502, message);
	}
};
