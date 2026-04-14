import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSellerToken, isSellerConnected } from '$lib/server/ebay-seller-auth';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import { parseJsonBody, requireNumber, optionalString, requireAuth } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';
import { getSellerPolicies, ensureInventoryLocation, publishOffer, optInToBusinessPolicies, EBAY_INVENTORY_URL } from '$lib/server/ebay-policies';
import { conditionToEbay, conditionToDescriptorId } from '$lib/server/ebay-condition';

export const config = { maxDuration: 60 };

const EBAY_CATEGORY_TRADING_CARDS = '183454';

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
		let policies = await getSellerPolicies(token);

		// If policies failed, try auto-enrolling in Business Policies and retry once
		if (!policies) {
			const enrolled = await optInToBusinessPolicies(token);
			if (enrolled) {
				console.log('[ebay-policies] Retrying policy fetch after Business Policy enrollment...');
				policies = await getSellerPolicies(token);
			}
		}

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
			const result = await publishOffer(offerId, token, sku);
			return json(result);
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
