import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSellerToken, isSellerConnected } from '$lib/server/ebay-seller-auth';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { parseJsonBody, requireNumber, optionalString, requireAuth } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';

export const config = { maxDuration: 60 };

const EBAY_INVENTORY_URL = 'https://api.ebay.com/sell/inventory/v1';
const EBAY_ACCOUNT_URL = 'https://api.ebay.com/sell/account/v1';
const EBAY_CATEGORY_TRADING_CARDS = '261328';

interface DraftRequest {
	cardId: string;
	heroName: string;
	cardNumber: string;
	setCode: string;
	parallel: string | null;
	weaponType: string | null;
	power: number | null;
	athleteName: string | null;
	condition: string;
	price: number;
	quantity: number;
	notes: string | null;
	scanImageUrl: string | null;
	title: string | null;
	description: string | null;
	forceNew?: boolean;
	// Listing options
	bestOffer?: boolean;
	autoAcceptPrice?: number | null;
	autoDeclinePrice?: number | null;
	packageWeightOz?: number | null;
	listingDuration?: string | null;
}

function buildTitle(req: DraftRequest): string {
	const parts = ['BoBA Bo Jackson Battle Arena'];
	if (req.heroName) parts.push(req.heroName);
	if (req.cardNumber) parts.push(`#${req.cardNumber}`);
	if (req.parallel) parts.push(req.parallel);
	if (req.weaponType) parts.push(req.weaponType);
	if (req.setCode) parts.push(req.setCode);
	// eBay title max 80 chars
	let title = parts.join(' ');
	if (title.length > 80) title = title.slice(0, 77) + '...';
	return title;
}

function buildDescription(req: DraftRequest): string {
	const lines = [
		`<h2>Bo Jackson Battle Arena - ${req.heroName || 'Hero Card'}</h2>`,
		'<ul>'
	];
	if (req.cardNumber) lines.push(`<li><strong>Card Number:</strong> ${req.cardNumber}</li>`);
	if (req.athleteName) lines.push(`<li><strong>Athlete Inspiration:</strong> ${req.athleteName}</li>`);
	if (req.setCode) lines.push(`<li><strong>Set:</strong> ${req.setCode}</li>`);
	if (req.parallel) lines.push(`<li><strong>Parallel/Variant:</strong> ${req.parallel}</li>`);
	if (req.weaponType) lines.push(`<li><strong>Weapon Type:</strong> ${req.weaponType}</li>`);
	if (req.power != null) lines.push(`<li><strong>Power:</strong> ${req.power}</li>`);
	lines.push(`<li><strong>Condition:</strong> ${req.condition || 'Near Mint'}</li>`);
	if (req.notes) lines.push(`<li><strong>Notes:</strong> ${req.notes}</li>`);
	lines.push('</ul>');
	lines.push('<p>Listed with BOBA Scanner - boba.cards</p>');
	return lines.join('\n');
}

/** Convert user-edited plain text description to simple HTML for eBay */
function plainTextToHtml(text: string): string {
	const escaped = text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	const paragraphs = escaped.split(/\n{2,}/);
	return paragraphs
		.map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
		.join('\n');
}

// eBay Inventory API condition enums for Trading Card categories (261328):
//   LIKE_NEW    = "Graded" (requires conditionDescriptors with grading info)
//   USED_VERY_GOOD = "Ungraded"
// All ungraded cards should use USED_VERY_GOOD regardless of physical condition.
// When we add grading support, graded cards will use LIKE_NEW + conditionDescriptors.
const CONDITION_MAP: Record<string, string> = {
	'mint': 'USED_VERY_GOOD',
	'nearmint': 'USED_VERY_GOOD',
	'near_mint': 'USED_VERY_GOOD',
	'excellent': 'USED_VERY_GOOD',
	'good': 'USED_VERY_GOOD',
	'fair': 'USED_VERY_GOOD',
	'poor': 'USED_VERY_GOOD'
};

function conditionToEbay(condition: string): string {
	const key = (condition || '').toLowerCase().replace(/[_\s]/g, '');
	return CONDITION_MAP[key] || 'USED_VERY_GOOD';
}

const CONDITION_DESCRIPTOR_MAP: Record<string, string> = {
	'mint': '400010',
	'nearmint': '400010',
	'near_mint': '400010',
	'excellent': '400011',
	'good': '400012',
	'fair': '400013',
	'poor': '400013'
};

function conditionToDescriptorId(condition: string): string {
	const key = (condition || '').toLowerCase().replace(/[_\s]/g, '');
	return CONDITION_DESCRIPTOR_MAP[key] || '400010';
}

async function getSellerPolicies(token: string): Promise<{
	fulfillmentPolicyId: string;
	envelopeFulfillmentPolicyId: string | null;
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
			if (!r.ok) {
				const body = await r.text().catch(() => '');
				console.error(`[ebay/create-draft] ${label} API returned ${r.status}:`, body);
				throw new Error(`eBay ${label} API returned ${r.status}`);
			}
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

		// Look for BOBA-specific policies first, then fall back to any existing policy
		const allFulfillment = fulfillment.fulfillmentPolicies || [];
		const envelopePolicy = allFulfillment.find(
			(p: Record<string, string>) => p.name?.includes('BOBA') && p.name?.includes('Envelope')
		);
		const firstClassPolicy = allFulfillment.find(
			(p: Record<string, string>) => p.name?.includes('BOBA') && p.name?.includes('First Class')
		);
		let envelopeFulfillmentId = envelopePolicy?.fulfillmentPolicyId || null;
		let fulfillmentId = firstClassPolicy?.fulfillmentPolicyId
			|| findPolicy(allFulfillment, 'fulfillmentPolicyId');
		let paymentId = findPolicy(payment.paymentPolicies, 'paymentPolicyId');
		let returnId = findPolicy(returns.returnPolicies, 'returnPolicyId');

		// Auto-create missing policies so sellers don't have to configure eBay manually
		if (!envelopeFulfillmentId) {
			console.log('[ebay/create-draft] No envelope fulfillment policy — creating');
			envelopeFulfillmentId = await createEnvelopeFulfillmentPolicy(headers);
		}
		if (!fulfillmentId) {
			console.log('[ebay/create-draft] No standard fulfillment policy — creating');
			fulfillmentId = await createFirstClassFulfillmentPolicy(headers);
			if (!fulfillmentId) fulfillmentId = envelopeFulfillmentId;
		}
		if (!paymentId) {
			console.log('[ebay/create-draft] No payment policy found — creating default');
			paymentId = await createDefaultPaymentPolicy(headers);
		}
		if (!returnId) {
			console.log('[ebay/create-draft] No return policy found — creating default');
			returnId = await createDefaultReturnPolicy(headers);
		}

		if (!fulfillmentId || !paymentId || !returnId) {
			console.error('[ebay/create-draft] Missing policies after auto-create attempt:', {
				fulfillmentId, paymentId, returnId
			});
			return null;
		}

		return {
			fulfillmentPolicyId: fulfillmentId,
			envelopeFulfillmentPolicyId: envelopeFulfillmentId,
			paymentPolicyId: paymentId,
			returnPolicyId: returnId
		};
	} catch (err) {
		console.error('[ebay/create-draft] Seller policies fetch failed:', err);
		return null;
	}
}

async function createFulfillmentPolicy(
	headers: Record<string, string>,
	name: string,
	shippingOptions: Record<string, unknown>[]
): Promise<string | null> {
	try {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/fulfillment_policy`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				name,
				marketplaceId: 'EBAY_US',
				handlingTime: { value: 1, unit: 'DAY' },
				shippingOptions
			})
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			// 409 = policy with this name already exists, try to find it
			if (res.status === 409) {
				console.log(`[ebay/create-draft] Fulfillment policy "${name}" already exists`);
				return null;
			}
			console.error('[ebay/create-draft] Failed to create fulfillment policy:', res.status, body);
			return null;
		}
		const data = await res.json();
		return data.fulfillmentPolicyId || null;
	} catch (err) {
		console.error('[ebay/create-draft] fulfillment policy creation error:', err);
		return null;
	}
}

async function createEnvelopeFulfillmentPolicy(headers: Record<string, string>): Promise<string | null> {
	return createFulfillmentPolicy(headers, 'BOBA - eBay Standard Envelope', [{
		optionType: 'DOMESTIC',
		costType: 'CALCULATED',
		shippingServices: [{
			shippingServiceCode: 'US_eBayStandardEnvelope',
			freeShipping: false,
			sortOrder: 1
		}]
	}]);
}

async function createFirstClassFulfillmentPolicy(headers: Record<string, string>): Promise<string | null> {
	return createFulfillmentPolicy(headers, 'BOBA - USPS First Class', [{
		optionType: 'DOMESTIC',
		costType: 'CALCULATED',
		shippingServices: [{
			shippingServiceCode: 'USPSFirstClass',
			freeShipping: false,
			sortOrder: 1
		}]
	}]);
}

async function createDefaultPaymentPolicy(headers: Record<string, string>): Promise<string | null> {
	try {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/payment_policy`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				name: 'BOBA Scanner - Managed Payments',
				marketplaceId: 'EBAY_US',
				paymentMethods: [{ paymentMethodType: 'PERSONAL_CHECK' }]
			})
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			console.error('[ebay/create-draft] Failed to create payment policy:', res.status, body);
			return null;
		}
		const data = await res.json();
		return data.paymentPolicyId || null;
	} catch (err) {
		console.error('[ebay/create-draft] payment policy creation error:', err);
		return null;
	}
}

async function createDefaultReturnPolicy(headers: Record<string, string>): Promise<string | null> {
	try {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/return_policy`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				name: 'BOBA Scanner - 30 Day Returns',
				marketplaceId: 'EBAY_US',
				returnsAccepted: true,
				returnPeriod: { value: 30, unit: 'DAY' },
				refundMethod: 'MONEY_BACK',
				returnShippingCostPayer: 'BUYER'
			})
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			console.error('[ebay/create-draft] Failed to create return policy:', res.status, body);
			return null;
		}
		const data = await res.json();
		return data.returnPolicyId || null;
	} catch (err) {
		console.error('[ebay/create-draft] return policy creation error:', err);
		return null;
	}
}

/**
 * Ensure the seller has at least one inventory location.
 * eBay requires this before an offer can be published (provides Item.Country).
 * If none exists, create a default US-based location.
 */
async function ensureInventoryLocation(token: string): Promise<boolean> {
	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		'Accept-Language': 'en-US',
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
	};

	try {
		// Check if any location already exists
		const res = await fetch(`${EBAY_INVENTORY_URL}/location?limit=1`, { headers });
		if (res.ok) {
			const data = await res.json();
			if (data.locations && data.locations.length > 0) {
				return true; // Location already exists
			}
		}

		// Create a default location — eBay requires postalCode + stateOrProvince
		// in addition to country for a valid inventory location
		const locationKey = 'boba-default';
		const createRes = await fetch(
			`${EBAY_INVENTORY_URL}/location/${locationKey}`,
			{
				method: 'POST',
				headers,
				body: JSON.stringify({
					location: {
						address: {
							postalCode: '10001',
							stateOrProvince: 'NY',
							country: 'US'
						}
					},
					merchantLocationStatus: 'ENABLED',
					locationTypes: ['WAREHOUSE'],
					name: 'Default Shipping Location'
				})
			}
		);

		if (createRes.ok || createRes.status === 204) {
			console.log('[ebay/create-draft] Created default inventory location');
			return true;
		}

		// 409 = location already exists with this key, which is fine
		if (createRes.status === 409) {
			return true;
		}

		const errBody = await createRes.text().catch(() => '');
		console.error('[ebay/create-draft] Inventory location creation failed:', createRes.status, errBody);
		return false;
	} catch (err) {
		console.warn('[ebay/create-draft] Inventory location check failed:', err);
		return false;
	}
}

async function publishOffer(offerId: string, token: string, sku: string) {
	const publishRes = await fetch(`${EBAY_INVENTORY_URL}/offer/${offerId}/publish`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			'Accept-Language': 'en-US',
			'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
		}
	});

	if (publishRes.ok) {
		const publishData = await publishRes.json().catch(() => ({}));
		const listingId = publishData.listingId;
		const listingUrl = listingId ? `https://www.ebay.com/itm/${listingId}` : null;

		// Update listing_templates with published status
		try {
			const adminClient = getAdminClient();
			if (adminClient) {
				const { error: updateErr } = await adminClient.from('listing_templates').update({
					status: 'published',
					ebay_offer_id: offerId,
					ebay_listing_id: listingId || null,
					ebay_listing_url: listingUrl,
					updated_at: new Date().toISOString()
				}).eq('sku', sku);
				if (updateErr) {
					console.error('[ebay/create-draft] Template publish update FAILED:', updateErr.message, updateErr.details);
				}
			}
		} catch (err) {
			console.error('[ebay/create-draft] Template publish update FAILED:', err);
		}

		return json({
			success: true,
			partial: false,
			listingId: listingId || null,
			listingUrl,
			offerId,
			sku,
			message: listingId
				? `Listed on eBay! View at ebay.com/itm/${listingId}`
				: 'Listing published on eBay'
		});
	}

	// Publish failed — offer exists but not live
	const publishErr = await publishRes.text().catch(() => '');
	console.error('[ebay/create-draft] Publish failed:', publishRes.status, publishErr);

	return json({
		success: true,
		partial: true,
		offerId,
		sku,
		message: 'Listing created but could not auto-publish. Check your eBay Seller Hub.',
		sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
	});
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);

	// Weekly listing limit for free users
	if (locals.supabase) {
		const { data: profile } = await locals.supabase.from('users').select('is_pro, is_admin').eq('auth_user_id', user.id).single();
		if (!profile?.is_pro && !profile?.is_admin) {
			const { data: countResult, error: countErr } = await locals.supabase.rpc('get_weekly_listing_count', { p_user_id: user.id });
			if (countErr) {
				console.error('[ebay/create-draft] Weekly count check failed:', countErr.message);
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
	if (!connected) throw error(403, 'eBay account not connected. Go to Settings to connect.');

	const body = await parseJsonBody<DraftRequest>(request);

	const price = requireNumber(body.price, 'price', 0.01);
	const quantity = requireNumber(body.quantity || 1, 'quantity', 1, 99);
	const heroName = optionalString(body.heroName);
	const cardNumber = optionalString(body.cardNumber);

	if (!heroName && !cardNumber) {
		throw error(400, 'Card info required (heroName or cardNumber)');
	}

	const token = await getSellerToken(user.id);
	if (!token) throw error(403, 'eBay session expired. Reconnect in Settings.');

	const adminClient = getAdminClient();
	const cardIdShort = (body.cardId || 'unknown').replace(/-/g, '').slice(0, 12);
	const sku = `BOBA${cardIdShort}${Date.now()}`;

	// Check for existing active listings for this card
	if (adminClient && body.cardId) {
		try {
			const { data: existingListings } = await adminClient
				.from('listing_templates')
				.select('id, sku, price, ebay_listing_id, ebay_listing_url, status, created_at')
				.eq('user_id', user.id)
				.eq('card_id', body.cardId)
				.in('status', ['published', 'draft', 'pending'])
				.order('created_at', { ascending: false })
				.limit(5);

			if (existingListings && existingListings.length > 0 && !body.forceNew) {
				// Return existing listings so the frontend can offer choices
				return json({
					success: false,
					existingListings,
					message: 'This card already has active listing(s)',
					cardId: body.cardId
				}, { status: 409 });
			}
		} catch (err) {
			console.debug('[ebay/create-draft] Existing listing check failed:', err);
			// Non-critical — continue with new listing
		}
	}

	// Persist listing template to DB for history tracking
	if (adminClient) {
		try {
			const { error: insertErr } = await adminClient.from('listing_templates').insert({
				user_id: user.id,
				card_id: body.cardId || null,
				title: body.title || buildTitle(body),
				description: body.description || buildDescription(body) || '',
				price,
				condition: body.condition || 'Near Mint',
				sku,
				status: 'pending',
				scan_image_url: body.scanImageUrl || null,
				hero_name: heroName || null,
				card_number: cardNumber || null,
				set_code: body.setCode || null,
				parallel: body.parallel || null,
				weapon_type: body.weaponType || null,
				created_at: new Date().toISOString()
			});
			if (insertErr) {
				console.error('[ebay/create-draft] Template save FAILED:', insertErr.message, insertErr.details, insertErr.hint);
			}
		} catch (err) {
			console.error('[ebay/create-draft] Template save FAILED:', err);
		}
	}

	try {

		// Use user-provided title/description if available, otherwise generate
		const listingTitle = body.title || buildTitle(body);
		const htmlDescription = body.description
			? plainTextToHtml(body.description)
			: buildDescription(body);

		// Step 1: Create or update inventory item
		const inventoryItem = {
			product: {
				title: listingTitle,
				description: htmlDescription,
				...(body.scanImageUrl && body.scanImageUrl.startsWith('https://') ? { imageUrls: [body.scanImageUrl] } : {}),
				aspects: {
					'Card Name': [heroName || 'Unknown'],
					'Set': [body.setCode || 'BoBA'],
					'Sport': ['Multi-Sport'],
					'Card Manufacturer': ['Bo Jackson Battle Arena'],
					...(cardNumber ? { 'Card Number': [cardNumber] } : {}),
					...(body.parallel ? { 'Parallel/Variety': [body.parallel] } : {}),
					...(body.athleteName ? { 'Player/Athlete': [body.athleteName] } : {})
				}
			},
			condition: conditionToEbay(body.condition),
			conditionDescriptors: [
				{ name: '40001', values: [conditionToDescriptorId(body.condition)] }
			],
			conditionDescription: body.notes || undefined,
			packageWeightAndSize: {
				weight: {
					value: body.packageWeightOz ?? (price >= 20 ? 4 : 1),
					unit: 'OUNCE'
				},
				packageType: price >= 20 ? 'PACKAGE_THICK_ENVELOPE' : 'LETTER'
			},
			availability: {
				shipToLocationAvailability: {
					quantity
				}
			}
		};

		const itemRes = await fetch(`${EBAY_INVENTORY_URL}/inventory_item/${encodeURIComponent(sku)}`, {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Content-Language': 'en-US',
				'Accept-Language': 'en-US',
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
			},
			body: JSON.stringify(inventoryItem)
		});

		if (!itemRes.ok) {
			const errBody = await itemRes.text().catch(() => '');
			console.error('[ebay/create-draft] Inventory item creation failed:', itemRes.status, errBody);
			if (itemRes.status === 401) {
				throw error(403, 'eBay session expired. Reconnect in Settings.');
			}
			let message = `eBay inventory item creation failed (${itemRes.status})`;
			try {
				const parsed = JSON.parse(errBody);
				if (parsed.errors?.[0]?.longMessage) {
					message = parsed.errors[0].longMessage;
				} else if (parsed.errors?.[0]?.message) {
					message = parsed.errors[0].message;
				}
			} catch { /* use default message */ }
			throw error(502, message);
		}

		// Step 2: Ensure seller has an inventory location (required for Item.Country on publish)
		const hasLocation = await ensureInventoryLocation(token);

		// Step 3: Try to fetch policies and create a full offer.
		// Some eBay accounts (Managed Payments) can't access the Business Policy API,
		// so if this fails we still return success with the inventory item created.
		const policies = await getSellerPolicies(token);

		if (!hasLocation || !policies) {
			// Policies unavailable — inventory item is created, user finishes in Seller Hub
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
				message: 'Card added to eBay inventory — tap "Finish in Seller Hub" to publish',
				sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
			});
		}

		// Step 4: Create offer (unpublished = draft in Seller Hub)
		const bestOfferEnabled = body.bestOffer !== false; // default ON

		const offer: Record<string, unknown> = {
			sku,
			marketplaceId: 'EBAY_US',
			format: 'FIXED_PRICE',
			merchantLocationKey: 'boba-default',
			listingDescription: htmlDescription,
			availableQuantity: quantity,
			pricingSummary: {
				price: {
					value: price.toFixed(2),
					currency: 'USD'
				}
			},
			categoryId: EBAY_CATEGORY_TRADING_CARDS,
			listingPolicies: {
				fulfillmentPolicyId: price < 20 && policies.envelopeFulfillmentPolicyId
					? policies.envelopeFulfillmentPolicyId
					: policies.fulfillmentPolicyId,
				returnPolicyId: policies.returnPolicyId,
				paymentPolicyId: policies.paymentPolicyId,
				...(bestOfferEnabled ? {
					bestOfferTerms: {
						bestOfferEnabled: true,
						...(body.autoAcceptPrice ? {
							autoAcceptPrice: {
								value: body.autoAcceptPrice.toFixed(2),
								currency: 'USD'
							}
						} : {}),
						...(body.autoDeclinePrice ? {
							autoDeclinePrice: {
								value: body.autoDeclinePrice.toFixed(2),
								currency: 'USD'
							}
						} : {})
					}
				} : {})
			},
			...(body.listingDuration ? { listingDuration: body.listingDuration } : {})
		};

		const offerRes = await fetch(`${EBAY_INVENTORY_URL}/offer`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Content-Language': 'en-US',
				'Accept-Language': 'en-US',
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
			},
			body: JSON.stringify(offer)
		});

		if (!offerRes.ok) {
			const errBody = await offerRes.text().catch(() => '');
			console.error('[ebay/create-draft] Offer creation failed:', offerRes.status, errBody);

			// Offer failed but inventory item exists — still a partial success
			if (offerRes.status === 401) {
				throw error(403, 'eBay session expired. Reconnect in Settings.');
			}

			// With unique SKUs, duplicate offers should not occur.
			// If they somehow do, the partial-success fallback below handles it.

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
			// Inventory item created, offer parse failed — partial success
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

		// Step 5: Publish the offer to make it a live listing.
		// eBay's Drafts UI does NOT show API-created unpublished offers,
		// so we must publish for the seller to see/manage it.
		const offerId = offerData.offerId;
		if (offerId) {
			return await publishOffer(offerId, token, sku);
		}

		// Full success — offer created
		if (adminClient) {
			try {
				await adminClient.from('listing_templates').update({
					status: 'draft',
					ebay_offer_id: offerData.offerId || null,
					updated_at: new Date().toISOString()
				}).eq('sku', sku);
			} catch { /* non-critical */ }
		}

		return json({
			success: true,
			partial: false,
			offerId: offerId || null,
			sku,
			message: 'Listing created on eBay'
		});
	} catch (err) {
		// Re-throw SvelteKit HttpErrors as-is (they already have status + message)
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const message = err instanceof Error ? err.message : 'Draft creation failed';
		console.error('[ebay/create-draft] Unexpected error:', message);

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

		throw error(502, `Draft creation failed: ${message}`);
	}
};
