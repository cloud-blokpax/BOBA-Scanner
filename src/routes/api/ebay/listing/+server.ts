import { json, error } from '@sveltejs/kit';
import { getSellerToken, isSellerConnected } from '$lib/server/ebay-seller-auth';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { parseJsonBody, requireString, requireNumber, requireAuth } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';
import {
	getSellerPolicies,
	ensureInventoryLocation,
	publishOffer,
	optInToBusinessPolicies,
	EBAY_INVENTORY_URL
} from '$lib/server/ebay-policies';
import { conditionToEbay, conditionToDescriptorId } from '$lib/server/ebay-condition';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const EBAY_CATEGORY_TRADING_CARDS = '183454';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);

	// Server-side feature gate — check overrides (free users now get limited access)
	if (locals.supabase) {
		const { data: override, error: overrideErr } = await locals.supabase.from('user_feature_overrides').select('enabled').eq('user_id', user.id).eq('feature_key', 'scan_to_list').maybeSingle();
		if (overrideErr) {
			console.error('[ebay/listing] Feature override lookup failed:', overrideErr.message);
		}
		if (override && !override.enabled) {
			throw error(403, 'Feature not available');
		}
	}

	// Weekly listing limit for free users
	if (locals.supabase) {
		const { data: profile } = await locals.supabase.from('users').select('is_pro, is_admin').eq('auth_user_id', user.id).single();
		if (!profile?.is_pro && !profile?.is_admin) {
			const { data: countResult, error: countErr } = await locals.supabase.rpc('get_weekly_listing_count', { p_user_id: user.id });
			if (countErr) {
				console.error('[ebay/listing] Weekly count check failed:', countErr.message);
			}
			const weeklyCount = typeof countResult === 'number' ? countResult : 0;
			if (weeklyCount >= 3) {
				return json({
					error: 'Weekly listing limit reached',
					message: 'Free accounts can create 3 listings per week. Upgrade to Pro for unlimited listings.',
					weekly_count: weeklyCount,
					weekly_limit: 3
				}, { status: 403 });
			}
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

	// Optional card detail fields (may be passed from ScanConfirmation)
	const heroName = (body.heroName as string) || null;
	const cardNumber = (body.cardNumber as string) || null;
	const setCode = (body.setCode as string) || null;
	const parallel = (body.parallel as string) || null;
	const weaponType = (body.weaponType as string) || null;

	const token = await getSellerToken(user.id);
	if (!token) throw error(403, 'eBay session expired. Please reconnect your eBay account.');

	const sku = `boba-${card_id}-${Date.now()}`;
	const adminClient = getAdminClient();

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
				hero_name: heroName,
				card_number: cardNumber,
				set_code: setCode,
				parallel,
				weapon_type: weaponType,
				created_at: new Date().toISOString()
			});
		} catch (err) {
			console.debug('[ebay/listing] Template save failed:', err);
		}
	}

	try {
		// Step 1: Create inventory item — matches create-draft pattern exactly
		const inventoryRes = await fetch(`${EBAY_INVENTORY_URL}/inventory_item/${encodeURIComponent(sku)}`, {
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
					// Always provide an image — eBay requires at least 1 photo for trading cards
					imageUrls: scanImageUrl && scanImageUrl.startsWith('https://')
						? [scanImageUrl]
						: ['https://boba.cards/icon-512.png'],
					aspects: {
						'Card Name': [heroName || 'Unknown'],
						'Set': [setCode || 'BoBA'],
						'Sport': ['Multi-Sport'],
						'Game': ['Bo Jackson Battle Arena'],
						'Card Manufacturer': ['Bo Jackson Battle Arena'],
						...(cardNumber ? { 'Card Number': [cardNumber] } : {}),
						...(parallel ? { 'Parallel/Variety': [parallel] } : {})
					}
				},
				// All ungraded BoBA cards use USED_VERY_GOOD per eBay trading card category rules
				condition: conditionToEbay(condition),
				conditionDescriptors: [
					{ name: '40001', values: [conditionToDescriptorId(condition)] }
				],
				conditionDescription: `${condition} condition`,
				packageWeightAndSize: {
					weight: {
						value: price >= 20 ? 4 : 1,
						unit: 'OUNCE'
					},
					packageType: price >= 20 ? 'PACKAGE_THICK_ENVELOPE' : 'LETTER'
				},
				availability: {
					shipToLocationAvailability: {
						quantity: 1
					}
				}
			})
		});

		if (!inventoryRes.ok) {
			const errData = await inventoryRes.json().catch(() => ({}));
			const errMsg = errData?.errors?.[0]?.longMessage || errData?.errors?.[0]?.message || `Inventory item creation failed: ${inventoryRes.status}`;
			if (inventoryRes.status === 401) {
				throw error(403, 'eBay session expired. Reconnect in Settings.');
			}
			throw new Error(errMsg);
		}

		// Step 2: Ensure seller has an inventory location (required for Item.Country on publish)
		const hasLocation = await ensureInventoryLocation(token);

		// Step 3: Fetch seller's business policies — with defensive opt-in retry
		let policies = await getSellerPolicies(token);

		if (!policies) {
			// Try auto-enrolling in Business Policies and retry once
			const enrolled = await optInToBusinessPolicies(token);
			if (enrolled) {
				console.log('[ebay/listing] Retrying policy fetch after Business Policy enrollment...');
				policies = await getSellerPolicies(token);
			}
		}

		if (!hasLocation || !policies) {
			// Partial success — inventory item exists, user finishes in Seller Hub
			if (adminClient) {
				try {
					await adminClient.from('listing_templates').update({
						status: 'draft',
						updated_at: new Date().toISOString()
					}).eq('sku', sku);
				} catch { /* non-critical */ }
			}
			return json({
				success: true,
				partial: true,
				sku,
				message: 'Card added to eBay inventory — finish listing in Seller Hub',
				sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
			});
		}

		// Step 4: Create offer
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
				merchantLocationKey: 'boba-default',
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
					fulfillmentPolicyId: price < 20 && policies.envelopeFulfillmentPolicyId
						? policies.envelopeFulfillmentPolicyId
						: policies.fulfillmentPolicyId,
					paymentPolicyId: policies.paymentPolicyId,
					returnPolicyId: policies.returnPolicyId
				}
			})
		});

		if (!offerRes.ok) {
			const errData = await offerRes.json().catch(() => ({}));
			console.error('[ebay/listing] Offer creation failed:', offerRes.status, JSON.stringify(errData));

			if (offerRes.status === 401) {
				throw error(403, 'eBay session expired. Reconnect in Settings.');
			}

			// Offer failed but inventory item exists — partial success
			if (adminClient) {
				try {
					await adminClient.from('listing_templates').update({
						status: 'draft',
						updated_at: new Date().toISOString()
					}).eq('sku', sku);
				} catch { /* non-critical */ }
			}
			return json({
				success: true,
				partial: true,
				sku,
				message: 'Card added to eBay inventory — finish listing in Seller Hub',
				sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
			});
		}

		let offerData;
		try {
			offerData = await offerRes.json();
		} catch {
			if (adminClient) {
				try {
					await adminClient.from('listing_templates').update({
						status: 'draft',
						updated_at: new Date().toISOString()
					}).eq('sku', sku);
				} catch { /* non-critical */ }
			}
			return json({
				success: true,
				partial: true,
				sku,
				message: 'Card added to eBay inventory — finish listing in Seller Hub',
				sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
			});
		}

		// Step 5: Publish the offer to make it a live listing
		const offerId = offerData.offerId;
		if (offerId) {
			const result = await publishOffer(offerId, token, sku);
			// Map to the response shape ScanConfirmation expects
			return json({
				success: result.success,
				listing_id: result.listingId || null,
				listing_url: result.listingUrl || null,
				sku: result.sku,
				partial: result.partial,
				...(result.sellerHubUrl ? { sellerHubUrl: result.sellerHubUrl } : {})
			});
		}

		// No offerId returned — shouldn't happen but handle gracefully
		return json({
			success: true,
			partial: true,
			sku,
			message: 'Card added to eBay inventory — finish listing in Seller Hub',
			sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
		});
	} catch (err) {
		// Re-throw SvelteKit HttpErrors as-is
		if (err && typeof err === 'object' && 'status' in err) throw err;
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
			} catch { /* non-critical */ }
		}

		throw error(502, `Listing creation failed: ${message}`);
	}
};
