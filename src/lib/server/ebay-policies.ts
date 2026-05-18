/**
 * eBay Account & Inventory API helpers.
 *
 * Manages seller business policies (fulfillment, payment, return),
 * inventory locations, and offer publishing. Extracted from create-draft
 * to keep the API route focused on request handling.
 */

import { getAdminClient } from '$lib/server/supabase-admin';
import { logEvent } from '$lib/server/diagnostics';

const EBAY_INVENTORY_URL = 'https://api.ebay.com/sell/inventory/v1';
const EBAY_ACCOUNT_URL = 'https://api.ebay.com/sell/account/v1';

export { EBAY_INVENTORY_URL, EBAY_ACCOUNT_URL };

// ── Seller Policies ─────────────────────────────────────────────

export interface SellerPolicies {
	fulfillmentPolicyId: string;
	envelopeFulfillmentPolicyId: string | null;
	paymentPolicyId: string;
	returnPolicyId: string;
}

export async function getSellerPolicies(
	token: string,
	userId?: string
): Promise<SellerPolicies | null> {
	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		'Accept-Language': 'en-US',
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
	};

	// Per-user policy ID overrides bypass auto-detection entirely. Used when
	// an account has a pre-configured working policy that should take
	// precedence over anything auto-create would mint — e.g. an eSE policy
	// hand-built in Seller Hub with the empirically-correct CALCULATED +
	// "eBay Send" + freeShipping:true config (verified via /api/ebay/verify-policy).
	let overrides: {
		envelope_fulfillment_policy_id: string | null;
		standard_fulfillment_policy_id: string | null;
		payment_policy_id_override: string | null;
		return_policy_id_override: string | null;
	} | null = null;

	if (userId) {
		const adminClient = getAdminClient();
		if (adminClient) {
			const { data, error: overrideErr } = await adminClient
				.from('ebay_seller_tokens')
				.select('envelope_fulfillment_policy_id, standard_fulfillment_policy_id, payment_policy_id_override, return_policy_id_override')
				.eq('user_id', userId)
				.maybeSingle();
			if (overrideErr) {
				console.error('[ebay-policies] Failed to fetch policy overrides:', overrideErr.message);
			} else {
				overrides = data;
			}
		}
	}

	try {
		const safeJson = async (r: Response, label: string) => {
			if (!r.ok) {
				const body = await r.text().catch(() => '');
				console.error(`[ebay-policies] ${label} API returned ${r.status}:`, body);
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

		// Envelope policy: override > name match > auto-create
		let envelopeFulfillmentId: string | null = overrides?.envelope_fulfillment_policy_id ?? null;
		if (envelopeFulfillmentId) {
			console.log('[ebay-policies] Using envelope policy override:', envelopeFulfillmentId);
		} else {
			const envelopePolicy = allFulfillment.find(
				(p: Record<string, string>) => p.name?.includes('BOBA') && p.name?.includes('Envelope')
			);
			envelopeFulfillmentId = envelopePolicy?.fulfillmentPolicyId || null;
		}

		// Standard fulfillment policy: override > name match > first available > auto-create
		let fulfillmentId: string | null = overrides?.standard_fulfillment_policy_id ?? null;
		if (fulfillmentId) {
			console.log('[ebay-policies] Using standard fulfillment policy override:', fulfillmentId);
		} else {
			const groundAdvantagePolicy = allFulfillment.find(
				(p: Record<string, string>) =>
					p.name?.includes('BOBA') &&
					(p.name?.includes('Ground Advantage') || p.name?.includes('First Class'))
			);
			fulfillmentId = groundAdvantagePolicy?.fulfillmentPolicyId
				|| findPolicy(allFulfillment, 'fulfillmentPolicyId');
		}

		let paymentId = overrides?.payment_policy_id_override
			|| findPolicy(payment.paymentPolicies, 'paymentPolicyId');
		let returnId = overrides?.return_policy_id_override
			|| findPolicy(returns.returnPolicies, 'returnPolicyId');

		// Auto-create missing policies so sellers don't have to configure eBay manually
		if (!envelopeFulfillmentId) {
			console.log('[ebay-policies] No envelope fulfillment policy — creating');
			envelopeFulfillmentId = await createEnvelopeFulfillmentPolicy(headers);

			// If creation returned null (409 conflict on name), the policy already
			// exists but our initial name-match missed it — refetch and search again
			// with a broader match so the seller still gets envelope pricing.
			if (!envelopeFulfillmentId) {
				console.log('[ebay-policies] Envelope policy creation returned null, refetching policies...');
				const refetch = await fetch(`${EBAY_ACCOUNT_URL}/fulfillment_policy?marketplace_id=EBAY_US`, { headers })
					.then(r => r.ok ? r.json() : null)
					.catch(() => null);
				const refetchPolicies: Array<Record<string, string>> = refetch?.fulfillmentPolicies || [];
				const retryEnvelopeSearch = refetchPolicies.find(
					(p) => p.name?.toLowerCase().includes('envelope')
				);
				envelopeFulfillmentId = retryEnvelopeSearch?.fulfillmentPolicyId || null;

				if (envelopeFulfillmentId) {
					console.log('[ebay-policies] Found existing envelope policy on retry:', envelopeFulfillmentId);
				} else {
					console.error('[ebay-policies] CRITICAL: Envelope policy still missing after creation attempt');
					void logEvent({
						level: 'error',
						event: 'ebay.policies.envelope_missing_after_create',
						context: { fulfillment_policy_count: refetchPolicies.length }
					});
				}
			}
		}
		if (!fulfillmentId) {
			console.log('[ebay-policies] No standard fulfillment policy — creating');
			fulfillmentId = await createGroundAdvantageFulfillmentPolicy(headers);
			if (!fulfillmentId) fulfillmentId = envelopeFulfillmentId;
		}
		if (!paymentId) {
			console.log('[ebay-policies] No payment policy found — creating default');
			paymentId = await createDefaultPaymentPolicy(headers);
		}
		if (!returnId) {
			console.log('[ebay-policies] No return policy found — creating default');
			returnId = await createDefaultReturnPolicy(headers);
		}

		if (!fulfillmentId || !paymentId || !returnId) {
			console.error('[ebay-policies] Missing policies after auto-create attempt:', {
				fulfillmentId, paymentId, returnId
			});
			return null;
		}

		console.log('[ebay-policies] Policies fetched successfully:', {
			fulfillmentPolicyId: fulfillmentId,
			envelopeFulfillmentPolicyId: envelopeFulfillmentId,
			paymentPolicyId: paymentId,
			returnPolicyId: returnId,
			hasEnvelopePolicy: !!envelopeFulfillmentId
		});

		return {
			fulfillmentPolicyId: fulfillmentId,
			envelopeFulfillmentPolicyId: envelopeFulfillmentId,
			paymentPolicyId: paymentId,
			returnPolicyId: returnId
		};
	} catch (err) {
		console.error('[ebay-policies] Seller policies fetch failed:', err);
		void logEvent({ level: 'error', event: 'ebay.policies.fetch_seller_failed', error: err });
		return null;
	}
}

async function createFulfillmentPolicy(
	headers: Record<string, string>,
	name: string,
	shippingOptions: Record<string, unknown>[],
	handlingDays: number = 2
): Promise<string | null> {
	try {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/fulfillment_policy`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				name,
				marketplaceId: 'EBAY_US',
				categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
				handlingTime: { value: handlingDays, unit: 'DAY' },
				shippingOptions
			})
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			// 409 = policy with this name already exists, try to find it
			if (res.status === 409) {
				console.log(`[ebay-policies] Fulfillment policy "${name}" already exists`);
				return null;
			}
			console.error('[ebay-policies] Failed to create fulfillment policy:', res.status, body);
			return null;
		}
		const data = await res.json();
		return data.fulfillmentPolicyId || null;
	} catch (err) {
		console.error('[ebay-policies] fulfillment policy creation error:', err);
		void logEvent({
			level: 'error',
			event: 'ebay.policies.create_fulfillment_failed',
			error: err,
			context: { policy_name: name }
		});
		return null;
	}
}

async function createEnvelopeFulfillmentPolicy(headers: Record<string, string>): Promise<string | null> {
	// Config verified empirically on production eBay accounts via the
	// /api/ebay/verify-policy endpoint (policy 266252755012, account petrarca08):
	//   - costType: CALCULATED        — eBay computes the rate server-side
	//   - shippingCarrierCode: USPS   — eBay stores this as "eBay Send" internally
	//   - shippingServiceCode: US_eBayStandardEnvelope
	//   - freeShipping: true          — buyer-pays variant (false) was tested
	//                                   2026-05-18 on petrarca08 and produced
	//                                   "ask seller for shipping quote" failures
	//   - handlingTime: 2 DAY         — matches the known-working reference policy
	//
	// eBay's developer docs claim eSE requires FLAT_RATE + USPS. The docs are
	// wrong — every working policy we've inspected on real accounts is
	// CALCULATED + "eBay Send". Trust the verify-policy endpoint, not the docs.
	//
	// Seller absorbs the ~$0.74 label cost out of proceeds; the pricing nudge
	// in the listing UI recovers it by suggesting a higher charm-priced rung.
	const policyId = await createFulfillmentPolicy(
		headers,
		'BOBA - eBay Standard Envelope',
		[{
			optionType: 'DOMESTIC',
			costType: 'CALCULATED',
			shippingServices: [{
				sortOrder: 1,
				shippingCarrierCode: 'USPS',
				shippingServiceCode: 'US_eBayStandardEnvelope',
				freeShipping: true
			}]
		}],
		2
	);

	if (!policyId) return null;

	// Verify what eBay actually stored — they silently transform some fields
	// (e.g. carrier USPS → "eBay Send" for eSE). Informational only; we don't
	// fail the create if verification breaks.
	try {
		const verifyRes = await fetch(`${EBAY_ACCOUNT_URL}/fulfillment_policy/${policyId}`, {
			method: 'GET',
			headers
		});
		if (verifyRes.ok) {
			const policy = await verifyRes.json();
			const svc = policy.shippingOptions?.[0]?.shippingServices?.[0];
			console.log('[ebay-policies] Envelope policy verified after create:', {
				id: policyId,
				costType: policy.shippingOptions?.[0]?.costType,
				carrier: svc?.shippingCarrierCode,
				service: svc?.shippingServiceCode,
				freeShipping: svc?.freeShipping
			});
		} else {
			console.warn(`[ebay-policies] Envelope policy created (${policyId}) but verification GET failed: ${verifyRes.status}`);
		}
	} catch (err) {
		console.warn('[ebay-policies] Envelope policy verification error:', err);
	}

	return policyId;
}

async function createGroundAdvantageFulfillmentPolicy(headers: Record<string, string>): Promise<string | null> {
	// For $20+ listings where eSE is not allowed.
	// USPSFirstClass deprecated by eBay — consolidated into USPSGroundAdvantage.
	// Buyer pays the calculated rate.
	return createFulfillmentPolicy(
		headers,
		'BOBA - USPS Ground Advantage',
		[{
			optionType: 'DOMESTIC',
			costType: 'CALCULATED',
			shippingServices: [{
				sortOrder: 1,
				shippingCarrierCode: 'USPS',
				shippingServiceCode: 'USPSGroundAdvantage',
				freeShipping: false
			}]
		}],
		2
	);
}

async function createDefaultPaymentPolicy(headers: Record<string, string>): Promise<string | null> {
	try {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/payment_policy`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				name: 'Card Scanner - Managed Payments',
				marketplaceId: 'EBAY_US',
				paymentMethods: [{ paymentMethodType: 'PERSONAL_CHECK' }]
			})
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			console.error('[ebay-policies] Failed to create payment policy:', res.status, body);
			return null;
		}
		const data = await res.json();
		return data.paymentPolicyId || null;
	} catch (err) {
		console.error('[ebay-policies] payment policy creation error:', err);
		void logEvent({ level: 'error', event: 'ebay.policies.create_payment_failed', error: err });
		return null;
	}
}

async function createDefaultReturnPolicy(headers: Record<string, string>): Promise<string | null> {
	try {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/return_policy`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				name: 'Card Scanner - 30 Day Returns',
				marketplaceId: 'EBAY_US',
				returnsAccepted: true,
				returnPeriod: { value: 30, unit: 'DAY' },
				refundMethod: 'MONEY_BACK',
				returnShippingCostPayer: 'BUYER'
			})
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			console.error('[ebay-policies] Failed to create return policy:', res.status, body);
			return null;
		}
		const data = await res.json();
		return data.returnPolicyId || null;
	} catch (err) {
		console.error('[ebay-policies] return policy creation error:', err);
		void logEvent({ level: 'error', event: 'ebay.policies.create_return_failed', error: err });
		return null;
	}
}

// ── Business Policy Enrollment ─────────────────────────────────

/**
 * Opt the seller into eBay's Business Policy program.
 * Must be called once per seller account before policies can be created.
 * Safe to call multiple times — 409 means already enrolled.
 *
 * Returns true if enrolled (or already was), false if failed.
 */
export async function optInToBusinessPolicies(token: string): Promise<boolean> {
	try {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/program/opt_in`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'Accept-Language': 'en-US',
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
			},
			body: JSON.stringify({ programType: 'SELLING_POLICY_MANAGEMENT' })
		});

		if (res.ok || res.status === 204 || res.status === 409) {
			console.log('[ebay-policies] Business Policy opt-in:', res.status === 409 ? 'already enrolled' : 'success');
			return true;
		}

		const body = await res.text().catch(() => '');
		console.error('[ebay-policies] Business Policy opt-in failed:', res.status, body);
		return false;
	} catch (err) {
		console.error('[ebay-policies] Business Policy opt-in error:', err);
		void logEvent({ level: 'error', event: 'ebay.policies.opt_in_failed', error: err });
		return false;
	}
}

// ── Inventory Location ──────────────────────────────────────────

/**
 * Ensure the seller has at least one inventory location.
 * eBay requires this before an offer can be published (provides Item.Country).
 * If none exists, create a default US-based location.
 */
export async function ensureInventoryLocation(token: string): Promise<boolean> {
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
				return true;
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
			console.log('[ebay-policies] Created default inventory location');
			return true;
		}

		// 409 = location already exists with this key, which is fine
		if (createRes.status === 409) {
			return true;
		}

		const errBody = await createRes.text().catch(() => '');
		console.error('[ebay-policies] Inventory location creation failed:', createRes.status, errBody);
		void logEvent({
			level: 'error',
			event: 'ebay.policies.inventory_location_create_failed',
			errorCode: String(createRes.status),
			context: { body_excerpt: errBody.slice(0, 500) }
		});
		return false;
	} catch (err) {
		console.warn('[ebay-policies] Inventory location check failed:', err);
		void logEvent({ level: 'warn', event: 'ebay.policies.inventory_location_check_failed', error: err });
		return false;
	}
}

// ── Offer Publishing ────────────────────────────────────────────

export interface PublishResult {
	success: boolean;
	partial: boolean;
	listingId?: string | null;
	listingUrl?: string | null;
	offerId: string;
	sku: string;
	message: string;
	sellerHubUrl?: string;
	/**
	 * Populated when publish fails (success=false). Carries the parsed eBay
	 * error reason so the caller can persist it to listing_templates and
	 * surface it in the listings dashboard. Pre-fix this was logged to
	 * console only; users saw a row stuck at status='pending' with no clue
	 * why.
	 */
	errorMessage?: string;
	errorCode?: string;
	httpStatus?: number;
}

/**
 * Publish an eBay offer and update the listing_templates record.
 * Returns a result object — caller is responsible for converting to HTTP response.
 */
export async function publishOffer(offerId: string, token: string, sku: string): Promise<PublishResult> {
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
					console.error('[ebay-policies] Template publish update FAILED:', updateErr.message, updateErr.details);
					void logEvent({
						level: 'error',
						event: 'ebay.policies.template_publish_update_failed',
						error: updateErr.message,
						errorCode: updateErr.code,
						context: { sku, offer_id: offerId }
					});
				}
			}
		} catch (err) {
			console.error('[ebay-policies] Template publish update FAILED:', err);
			void logEvent({
				level: 'error',
				event: 'ebay.policies.template_publish_update_failed',
				error: err,
				context: { sku, offer_id: offerId }
			});
		}

		return {
			success: true,
			partial: false,
			listingId: listingId || null,
			listingUrl,
			offerId,
			sku,
			message: listingId
				? `Listed on eBay! View at ebay.com/itm/${listingId}`
				: 'Listing published on eBay'
		};
	}

	// Publish failed — offer exists on eBay but is not live. Parse the
	// response body for a usable reason, persist it to listing_templates
	// (status='error' + error_message), and return success=false so the
	// API endpoint returns 502 instead of pretending nothing went wrong.
	const publishErr = await publishRes.text().catch(() => '');
	console.error('[ebay-policies] Publish failed:', publishRes.status, publishErr);

	let parsedMessage: string | null = null;
	let parsedCode: string | null = null;
	try {
		const parsed = JSON.parse(publishErr);
		const firstErr = parsed?.errors?.[0];
		if (firstErr) {
			parsedMessage = firstErr.longMessage || firstErr.message || null;
			parsedCode = firstErr.errorId != null ? String(firstErr.errorId) : null;
		}
	} catch {
		// non-JSON body — fall through to default message
	}
	const errorMessage = parsedMessage
		|| `eBay publish failed (HTTP ${publishRes.status})`;
	const errorCode = parsedCode || `ebay_publish_${publishRes.status}`;

	void logEvent({
		level: 'error',
		event: 'ebay.policies.publish_failed',
		error: errorMessage,
		errorCode,
		context: {
			sku,
			offer_id: offerId,
			http_status: publishRes.status,
			body_excerpt: publishErr.slice(0, 500)
		}
	});

	try {
		const adminClient = getAdminClient();
		if (adminClient) {
			const { error: updateErr } = await adminClient.from('listing_templates').update({
				status: 'error',
				ebay_offer_id: offerId,
				error_message: `${errorCode}: ${errorMessage}`.slice(0, 1000),
				updated_at: new Date().toISOString()
			}).eq('sku', sku);
			if (updateErr) {
				console.error('[ebay-policies] Template error-state update FAILED:', updateErr.message);
				void logEvent({
					level: 'error',
					event: 'ebay.policies.template_error_update_failed',
					error: updateErr.message,
					errorCode: updateErr.code,
					context: { sku, offer_id: offerId }
				});
			}
		}
	} catch (err) {
		console.error('[ebay-policies] Template error-state update FAILED:', err);
		void logEvent({
			level: 'error',
			event: 'ebay.policies.template_error_update_failed',
			error: err,
			context: { sku, offer_id: offerId }
		});
	}

	return {
		success: false,
		partial: false,
		offerId,
		sku,
		message: `Listing not published: ${errorMessage}`,
		errorMessage,
		errorCode,
		httpStatus: publishRes.status,
		sellerHubUrl: 'https://www.ebay.com/sh/lst/active'
	};
}
