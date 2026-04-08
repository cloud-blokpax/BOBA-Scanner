import { json, error } from '@sveltejs/kit';
import { getSellerToken, isSellerConnected } from '$lib/server/ebay-seller-auth';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { parseJsonBody, requireString, requireNumber, requireAuth } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

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
		'Accept-Language': 'en-US',
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
	};

	try {
		const safeJson = async (r: Response, label: string) => {
			if (!r.ok) throw new Error(`eBay ${label} API returned ${r.status}`);
			return r.json();
		};
		const [fulfillment, payment, returns] = await Promise.all([
			fetch(`${EBAY_ACCOUNT_URL}/fulfillment_policy?marketplace_id=EBAY_US`, { headers }).then(r => safeJson(r, 'fulfillment_policy')),
			fetch(`${EBAY_ACCOUNT_URL}/payment_policy?marketplace_id=EBAY_US`, { headers }).then(r => safeJson(r, 'payment_policy')),
			fetch(`${EBAY_ACCOUNT_URL}/return_policy?marketplace_id=EBAY_US`, { headers }).then(r => safeJson(r, 'return_policy'))
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
	} catch (err) {
		console.debug('[ebay/listing] Seller policies fetch failed:', err);
		return null;
	}
}

const CONDITION_MAP: Record<string, { conditionEnum: string; conditionDescription: string }> = {
	'Mint': { conditionEnum: 'LIKE_NEW', conditionDescription: 'Brand New' },
	'Near Mint': { conditionEnum: 'LIKE_NEW', conditionDescription: 'Near Mint condition' },
	'Excellent': { conditionEnum: 'LIKE_NEW', conditionDescription: 'Like New, minimal wear' },
	'Good': { conditionEnum: 'USED_VERY_GOOD', conditionDescription: 'Good condition, light play wear' },
	'Fair': { conditionEnum: 'USED_GOOD', conditionDescription: 'Acceptable condition, visible wear' },
	'Poor': { conditionEnum: 'USED_ACCEPTABLE', conditionDescription: 'Heavily played condition' }
};

// Service-role client is now imported from $lib/server/supabase-admin
const getServiceClient = getAdminClient;

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);

	// Server-side feature gate
	if (locals.supabase) {
		const { data: profile, error: profileErr } = await locals.supabase.from('users').select('is_pro, is_admin').eq('auth_user_id', user.id).single();
		if (profileErr) {
			console.error('[ebay/listing] Profile lookup failed:', profileErr.message);
			throw error(500, 'Failed to verify account status');
		}
		const { data: override, error: overrideErr } = await locals.supabase.from('user_feature_overrides').select('enabled').eq('user_id', user.id).eq('feature_key', 'scan_to_list').maybeSingle();
		if (overrideErr) {
			console.error('[ebay/listing] Feature override lookup failed:', overrideErr.message);
		}
		if (override) {
			if (!override.enabled) throw error(403, 'Feature not available');
		} else if (!profile?.is_pro && !profile?.is_admin) {
			throw error(403, 'Premium feature — upgrade to access Scan-to-List');
		}
	}

	const rateLimit = await checkHeavyMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many listing requests' }, {
			status: 429,
			headers: {
				'X-RateLimit-Limit': String(rateLimit.limit),
				'X-RateLimit-Remaining': String(rateLimit.remaining),
				'X-RateLimit-Reset': String(rateLimit.reset)
			}
		});
	}

	const connected = await isSellerConnected(user.id);
	if (!connected) throw error(403, 'eBay account not connected. Please connect your eBay seller account in Settings.');

	const body = await parseJsonBody(request);
	const card_id = requireString(body.card_id, 'card_id');
	const title = requireString(body.title, 'title', 500);
	const description = body.description as string || '';
	const price = requireNumber(body.price, 'price', 0.01);
	const condition = (body.condition as string) || 'Near Mint';
	const scanImageUrl = (body.scanImageUrl as string) || null;

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
				scan_image_url: scanImageUrl,
				hero_name: (body.heroName as string) || null,
				card_number: (body.cardNumber as string) || null,
				set_code: (body.setCode as string) || null,
				parallel: (body.parallel as string) || null,
				weapon_type: (body.weaponType as string) || null,
				created_at: new Date().toISOString()
			});
		} catch (err) {
			console.debug('[ebay/listing] Template save failed:', err);
		}
	}

	try {
		// Step 1: Create inventory item
		const inventoryRes = await fetch(`${EBAY_INVENTORY_URL}/inventory_item/${sku}`, {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Content-Language': 'en-US',
				'Accept-Language': 'en-US',
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
			},
			body: JSON.stringify({
				product: {
					title,
					description,
					...(scanImageUrl && scanImageUrl.startsWith('https://') ? { imageUrls: [scanImageUrl] } : {}),
					aspects: {
						'Card Game': ['Bo Jackson Battle Arena'],
						'Card Condition': [condition]
					}
				},
				condition: conditionInfo.conditionEnum,
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
				'Content-Language': 'en-US',
				'Accept-Language': 'en-US',
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
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
		} catch (err) {
			console.debug('[ebay/listing] Offer response parse failed:', err);
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
				'Content-Type': 'application/json',
				'Content-Language': 'en-US',
				'Accept-Language': 'en-US',
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
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
		} catch (err) {
			console.debug('[ebay/listing] Publish response parse failed:', err);
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
			} catch (err) {
				console.debug('[ebay/listing] Template status update failed:', err);
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
		console.error('[ebay/listing] Listing creation error:', message);

		// Update template with error
		if (adminClient) {
			try {
				await adminClient.from('listing_templates').update({
					status: 'error',
					error_message: message,
					updated_at: new Date().toISOString()
				}).eq('sku', sku);
			} catch (err) {
				console.debug('[ebay/listing] Template error update failed:', err);
			}
		}

		throw error(502, 'Listing creation failed');
	}
};
