/**
 * GET /api/ebay/verify-policy?id={policyId}&type={fulfillment|payment|return}
 *
 * Admin-only. Fetches the full configuration of a specific eBay policy by ID
 * directly from eBay's Account API. Used to verify what's actually stored
 * before relying on the policy for listings.
 *
 * Defaults to type=fulfillment since that's the most common verification use case.
 *
 * Returns the raw eBay response plus a parsed summary highlighting the fields
 * that matter for eBay Standard Envelope (eSE) compatibility:
 *  - costType (must be FLAT_RATE for eSE)
 *  - freeShipping (must be true for eSE to work without "ask seller" failure)
 *  - shippingServiceCode (must be US_eBayStandardEnvelope)
 *  - shippingCarrierCode (must be USPS)
 *  - handlingTime (typically 1-3 days)
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getSellerToken } from '$lib/server/ebay-seller-auth';
import { logEbayUsage } from '$lib/server/ebay-usage-log';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 30 };

const EBAY_ACCOUNT_URL = 'https://api.ebay.com/sell/account/v1';

type PolicyType = 'fulfillment' | 'payment' | 'return';

const POLICY_ENDPOINTS: Record<PolicyType, string> = {
	fulfillment: 'fulfillment_policy',
	payment: 'payment_policy',
	return: 'return_policy'
};

interface ESEDiagnosis {
	is_ese_policy: boolean;
	will_work: boolean;
	expected_buyer_experience: string;
	issues: string[];
	verdict: 'ese_free_shipping_working' | 'ese_buyer_pays_risky' | 'not_ese' | 'misconfigured';
}

/**
 * Analyze a fulfillment policy for eSE compatibility.
 * Returns an actionable diagnosis explaining what the buyer will see on the listing.
 */
function diagnoseEnvelopePolicy(policy: Record<string, unknown>): ESEDiagnosis {
	const issues: string[] = [];
	const shippingOptions = (policy.shippingOptions as Array<Record<string, unknown>>) || [];
	const firstOption = shippingOptions[0] || {};
	const services = (firstOption.shippingServices as Array<Record<string, unknown>>) || [];
	const firstService = services[0] || {};

	const serviceCode = firstService.shippingServiceCode as string | undefined;
	const carrierCode = firstService.shippingCarrierCode as string | undefined;
	const costType = firstOption.costType as string | undefined;
	const freeShipping = firstService.freeShipping as boolean | undefined;

	const isESE = serviceCode === 'US_eBayStandardEnvelope';

	if (!isESE) {
		return {
			is_ese_policy: false,
			will_work: true,
			expected_buyer_experience: `Standard shipping via ${serviceCode || 'unknown service'}`,
			issues: [],
			verdict: 'not_ese'
		};
	}

	if (costType !== 'FLAT_RATE') {
		issues.push(
			`costType is "${costType}" — eSE REQUIRES "FLAT_RATE". Buyer will see "ask seller for shipping quote".`
		);
	}
	if (carrierCode !== 'USPS') {
		issues.push(`shippingCarrierCode is "${carrierCode}" — eSE REQUIRES "USPS".`);
	}

	if (freeShipping === true) {
		return {
			is_ese_policy: true,
			will_work: issues.length === 0,
			expected_buyer_experience:
				issues.length === 0
					? 'Buyer sees "Free shipping · eBay Standard Envelope". Seller absorbs ~$0.74 label cost out of proceeds.'
					: 'Will likely fail — buyer sees "ask seller for shipping quote"',
			issues,
			verdict: issues.length === 0 ? 'ese_free_shipping_working' : 'misconfigured'
		};
	}

	if (freeShipping === false || freeShipping === undefined) {
		issues.push(
			'freeShipping is not true. eBay\'s official eSE docs ONLY show the freeShipping:true pattern. ' +
				'Buyer-pays eSE is undocumented and historically causes "ask seller for shipping quote" failure on the listing page. ' +
				'Strongly recommend using freeShipping:true and recovering the $0.74 label cost via the pricing nudge instead.'
		);
		return {
			is_ese_policy: true,
			will_work: false,
			expected_buyer_experience:
				'HIGH RISK — buyer likely sees "ask seller for shipping quote" instead of a shipping cost. Buyer-pays eSE is not officially supported.',
			issues,
			verdict: 'ese_buyer_pays_risky'
		};
	}

	return {
		is_ese_policy: true,
		will_work: issues.length === 0,
		expected_buyer_experience: 'Unknown configuration — review raw policy data below',
		issues,
		verdict: 'misconfigured'
	};
}

export const GET: RequestHandler = async ({ url, locals, request, getClientAddress }) => {
	const user = await requireAdmin(locals);
	const clientIp = getClientAddress();
	const userAgent = request.headers.get('user-agent');

	const policyId = url.searchParams.get('id');
	const policyType = (url.searchParams.get('type') || 'fulfillment') as PolicyType;

	if (!policyId) {
		throw error(400, 'Missing required parameter: id');
	}

	if (!POLICY_ENDPOINTS[policyType]) {
		throw error(400, `Invalid policy type "${policyType}". Must be one of: fulfillment, payment, return`);
	}

	if (!/^\d{6,20}$/.test(policyId)) {
		throw error(400, 'Invalid policy ID format — must be a numeric string');
	}

	const token = await getSellerToken(user.id);
	if (!token) {
		throw error(401, 'No eBay seller token found for current admin user. Connect your eBay account first.');
	}

	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		'Accept-Language': 'en-US',
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
	};

	const endpoint = `${EBAY_ACCOUNT_URL}/${POLICY_ENDPOINTS[policyType]}/${policyId}`;
	const start = Date.now();

	let response: Response;
	try {
		response = await fetch(endpoint, { method: 'GET', headers });
	} catch (err) {
		void logEbayUsage({
			userId: user.id,
			endpoint: `sell.account.get_${policyType}_policy`,
			httpMethod: 'GET',
			httpStatus: 0,
			success: false,
			errorMessage: err instanceof Error ? err.message : String(err),
			requestPath: '/api/ebay/verify-policy',
			ipAddress: clientIp,
			userAgent,
			durationMs: Date.now() - start
		});
		return json(
			{
				ok: false,
				error: 'Network error fetching policy from eBay',
				details: err instanceof Error ? err.message : String(err)
			},
			{ status: 502 }
		);
	}

	const durationMs = Date.now() - start;
	const responseText = await response.text();
	let policy: Record<string, unknown> | null = null;
	let parseError: string | null = null;

	try {
		policy = JSON.parse(responseText);
	} catch (err) {
		parseError = err instanceof Error ? err.message : 'JSON parse failed';
	}

	void logEbayUsage({
		userId: user.id,
		endpoint: `sell.account.get_${policyType}_policy`,
		httpMethod: 'GET',
		httpStatus: response.status,
		success: response.ok,
		errorMessage: response.ok ? null : `HTTP ${response.status}`,
		requestPath: '/api/ebay/verify-policy',
		ipAddress: clientIp,
		userAgent,
		durationMs
	});

	if (!response.ok) {
		return json(
			{
				ok: false,
				http_status: response.status,
				policy_id: policyId,
				policy_type: policyType,
				error:
					response.status === 404
						? `Policy ${policyId} not found on this seller's eBay account. Policies are seller-scoped — make sure this ID belongs to your account.`
						: response.status === 401
							? 'eBay rejected the auth token. Try reconnecting your eBay account.'
							: `eBay returned HTTP ${response.status}`,
				raw_response: responseText.slice(0, 2000)
			},
			{ status: response.status }
		);
	}

	if (!policy || parseError) {
		return json(
			{
				ok: false,
				error: 'eBay returned non-JSON response',
				parse_error: parseError,
				raw_response: responseText.slice(0, 2000)
			},
			{ status: 502 }
		);
	}

	let summary: Record<string, unknown> | null = null;
	let diagnosis: ESEDiagnosis | null = null;

	if (policyType === 'fulfillment') {
		const shippingOptions = (policy.shippingOptions as Array<Record<string, unknown>>) || [];
		const firstOption = shippingOptions[0] || {};
		const services = (firstOption.shippingServices as Array<Record<string, unknown>>) || [];
		const firstService = services[0] || {};

		summary = {
			policy_id: policy.fulfillmentPolicyId,
			policy_name: policy.name,
			marketplace: policy.marketplaceId,
			handling_time: policy.handlingTime,
			shipping_option_count: shippingOptions.length,
			first_option: {
				option_type: firstOption.optionType,
				cost_type: firstOption.costType
			},
			first_service: {
				service_code: firstService.shippingServiceCode,
				carrier_code: firstService.shippingCarrierCode,
				free_shipping: firstService.freeShipping,
				sort_order: firstService.sortOrder,
				shipping_cost: firstService.shippingCost
			}
		};

		diagnosis = diagnoseEnvelopePolicy(policy);
	}

	return json({
		ok: true,
		policy_id: policyId,
		policy_type: policyType,
		http_status: response.status,
		duration_ms: durationMs,
		diagnosis,
		summary,
		raw_policy: policy
	});
};
