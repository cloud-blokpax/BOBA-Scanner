import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSellerToken, isSellerConnected } from '$lib/server/ebay-seller-auth';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { parseJsonBody, requireNumber, optionalString, requireAuth } from '$lib/server/validate';

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
		console.debug('[ebay/create-draft] Seller policies fetch failed:', err);
		return null;
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);

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

	try {
		const sku = `BOBA-${body.cardId || Date.now()}`;

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
			conditionDescription: body.notes || undefined,
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

		// Step 2: Try to fetch policies and create a full offer.
		// Some eBay accounts (Managed Payments) can't access the Business Policy API,
		// so if this fails we still return success with the inventory item created.
		const policies = await getSellerPolicies(token);

		if (!policies) {
			// Policies unavailable — inventory item is created, user finishes in Seller Hub
			return json({
				success: true,
				partial: true,
				sku,
				message: 'Card added to eBay inventory — tap "Finish in Seller Hub" to publish',
				sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
			});
		}

		// Step 3: Create offer (unpublished = draft in Seller Hub)
		const offer = {
			sku,
			marketplaceId: 'EBAY_US',
			format: 'FIXED_PRICE',
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
				fulfillmentPolicyId: policies.fulfillmentPolicyId,
				returnPolicyId: policies.returnPolicyId,
				paymentPolicyId: policies.paymentPolicyId
			}
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
			return json({
				success: true,
				partial: true,
				sku,
				message: 'Card added to eBay inventory — finish listing in Seller Hub',
				sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
			});
		}

		// Step 4: Publish the offer to make it a live listing.
		// eBay's Drafts UI does NOT show API-created unpublished offers,
		// so we must publish for the seller to see/manage it.
		const offerId = offerData.offerId;
		if (offerId) {
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
				return json({
					success: true,
					partial: false,
					listingId: listingId || null,
					listingUrl: listingId ? `https://www.ebay.com/itm/${listingId}` : null,
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

			// Still return the offer info — seller can publish manually from Seller Hub
			return json({
				success: true,
				partial: true,
				offerId,
				sku,
				message: 'Listing created but could not auto-publish. Check your eBay Seller Hub.',
				sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
			});
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
		throw error(502, `Draft creation failed: ${message}`);
	}
};
