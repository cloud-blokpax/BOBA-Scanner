import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSellerToken, isSellerConnected } from '$lib/server/ebay-seller-auth';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { parseJsonBody, requireNumber, optionalString } from '$lib/server/validate';

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

const CONDITION_MAP: Record<string, string> = {
	'mint': '2750',
	'nearmint': '4000',
	'excellent': '4000',
	'good': '5000',
	'fair': '6000',
	'poor': '7000'
};

function conditionToEbay(condition: string): string {
	const key = (condition || '').toLowerCase().replace(/[_\s]/g, '');
	return CONDITION_MAP[key] || '4000';
}

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
	const user = locals.user;
	if (!user) throw error(401, 'Authentication required');

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

	const sku = `BOBA-${body.cardId || Date.now()}`;

	// Step 1: Create or update inventory item
	const inventoryItem = {
		product: {
			title: buildTitle(body),
			description: buildDescription(body),
			...(body.scanImageUrl ? { imageUrls: [body.scanImageUrl] } : {}),
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
			'Content-Language': 'en-US'
		},
		body: JSON.stringify(inventoryItem)
	});

	if (!itemRes.ok) {
		const errBody = await itemRes.text().catch(() => '');
		console.error('[ebay/create-draft] Inventory item creation failed:', itemRes.status, errBody);
		if (itemRes.status === 401) {
			throw error(403, 'eBay session expired. Reconnect in Settings.');
		}
		throw error(500, `eBay API error: ${itemRes.status}`);
	}

	// Step 2: Look up the seller's business policies
	const policies = await getSellerPolicies(token);
	if (!policies) {
		throw error(400, 'Missing eBay business policies. Set up shipping, returns, and payment policies in eBay Seller Hub before listing.');
	}

	// Step 3: Create offer (unpublished = draft in Seller Hub)
	const offer = {
		sku,
		marketplaceId: 'EBAY_US',
		format: 'FIXED_PRICE',
		listingDescription: buildDescription(body),
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
			'Content-Language': 'en-US'
		},
		body: JSON.stringify(offer)
	});

	if (!offerRes.ok) {
		const errBody = await offerRes.text().catch(() => '');
		console.error('[ebay/create-draft] Offer creation failed:', offerRes.status, errBody);

		let message = `eBay offer creation failed (${offerRes.status})`;
		try {
			const parsed = JSON.parse(errBody);
			const errors = parsed.errors || [];
			const policyError = errors.find((e: { errorId?: number }) =>
				e.errorId === 25002 || e.errorId === 25001 || e.errorId === 25710
			);
			if (policyError) {
				message = 'Missing eBay business policies. Set up shipping, returns, and payment policies in eBay Seller Hub before listing.';
			} else if (errors[0]?.message) {
				message = errors[0].message;
			}
		} catch { /* use default message */ }

		if (offerRes.status === 401) {
			throw error(403, 'eBay session expired. Reconnect in Settings.');
		}
		throw error(500, message);
	}

	const offerData = await offerRes.json();
	if (!offerData.offerId) {
		throw error(500, 'eBay API did not return an offer ID');
	}

	return json({
		success: true,
		offerId: offerData.offerId,
		sku,
		message: 'Draft listing created in your eBay Seller Hub'
	});
};
