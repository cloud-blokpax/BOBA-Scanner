/**
 * POST /api/ebay/setup — One-time eBay Business Policy setup
 *
 * Admin-only. Opts the seller into eBay's Business Policy program
 * and creates default shipping/payment/return policies if none exist.
 * After this runs successfully, the create-draft flow works fully automated.
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getSellerToken } from '$lib/server/ebay-seller-auth';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const EBAY_ACCOUNT_URL = 'https://api.ebay.com/sell/account/v1';

function makeHeaders(token: string) {
	return {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		'Accept-Language': 'en-US',
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
	};
}

export const POST: RequestHandler = async ({ locals }) => {
	const user = await requireAdmin(locals);
	const token = await getSellerToken(user.id);
	if (!token) throw error(403, 'eBay session expired. Reconnect in Settings.');

	const headers = makeHeaders(token);
	const results: Array<{ step: string; ok: boolean; detail?: unknown }> = [];

	// ── Step 1: Opt into Business Policies program ────────────────
	try {
		const optInRes = await fetch(`${EBAY_ACCOUNT_URL}/program/opt_in`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ programType: 'SELLING_POLICY_MANAGEMENT' })
		});

		if (optInRes.ok || optInRes.status === 204) {
			results.push({ step: 'opt_in', ok: true, detail: 'Opted into Business Policies' });
		} else {
			const body = await optInRes.text().catch(() => '');
			// 409 = already opted in, which is fine
			if (optInRes.status === 409) {
				results.push({ step: 'opt_in', ok: true, detail: 'Already opted in' });
			} else {
				results.push({ step: 'opt_in', ok: false, detail: { status: optInRes.status, body: body.slice(0, 500) } });
			}
		}
	} catch (err) {
		results.push({ step: 'opt_in', ok: false, detail: err instanceof Error ? err.message : String(err) });
	}

	// ── Step 2: Check existing policies ───────────────────────────
	const safeJson = async (url: string) => {
		try {
			const res = await fetch(url, { headers });
			if (!res.ok) return null;
			return await res.json();
		} catch {
			return null;
		}
	};

	const fulfillmentData = await safeJson(`${EBAY_ACCOUNT_URL}/fulfillment_policy?marketplace_id=EBAY_US`);
	const paymentData = await safeJson(`${EBAY_ACCOUNT_URL}/payment_policy?marketplace_id=EBAY_US`);
	const returnData = await safeJson(`${EBAY_ACCOUNT_URL}/return_policy?marketplace_id=EBAY_US`);

	const hasFulfillment = (fulfillmentData?.fulfillmentPolicies?.length ?? 0) > 0;
	const hasPayment = (paymentData?.paymentPolicies?.length ?? 0) > 0;
	const hasReturn = (returnData?.returnPolicies?.length ?? 0) > 0;

	results.push({
		step: 'check_policies',
		ok: true,
		detail: { fulfillment: hasFulfillment, payment: hasPayment, return: hasReturn }
	});

	// ── Step 3: Create missing policies ───────────────────────────
	if (!hasFulfillment) {
		try {
			const res = await fetch(`${EBAY_ACCOUNT_URL}/fulfillment_policy`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					name: 'BOBA Standard Shipping',
					description: 'Standard shipping for trading cards',
					marketplaceId: 'EBAY_US',
					categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
					handlingTime: { value: 2, unit: 'DAY' },
					shippingOptions: [{
						optionType: 'DOMESTIC',
						costType: 'FLAT_RATE',
						shippingServices: [{
							shippingServiceCode: 'ShippingMethodStandard',
							shippingCost: { value: '0.00', currency: 'USD' },
							additionalShippingCost: { value: '0.00', currency: 'USD' },
							freeShipping: true,
							sortOrder: 1,
							buyerResponsibleForShipping: false
						}]
					}]
				})
			});
			const body = await res.text().catch(() => '');
			results.push({ step: 'create_fulfillment', ok: res.ok, detail: { status: res.status, body: body.slice(0, 500) } });
		} catch (err) {
			results.push({ step: 'create_fulfillment', ok: false, detail: err instanceof Error ? err.message : String(err) });
		}
	} else {
		results.push({ step: 'create_fulfillment', ok: true, detail: 'Already exists' });
	}

	if (!hasPayment) {
		try {
			const res = await fetch(`${EBAY_ACCOUNT_URL}/payment_policy`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					name: 'BOBA Immediate Payment',
					description: 'Immediate payment required',
					marketplaceId: 'EBAY_US',
					categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
					immediatePay: true
				})
			});
			const body = await res.text().catch(() => '');
			results.push({ step: 'create_payment', ok: res.ok, detail: { status: res.status, body: body.slice(0, 500) } });
		} catch (err) {
			results.push({ step: 'create_payment', ok: false, detail: err instanceof Error ? err.message : String(err) });
		}
	} else {
		results.push({ step: 'create_payment', ok: true, detail: 'Already exists' });
	}

	if (!hasReturn) {
		try {
			const res = await fetch(`${EBAY_ACCOUNT_URL}/return_policy`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					name: 'BOBA No Returns',
					description: 'No returns accepted',
					marketplaceId: 'EBAY_US',
					categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
					returnsAccepted: false
				})
			});
			const body = await res.text().catch(() => '');
			results.push({ step: 'create_return', ok: res.ok, detail: { status: res.status, body: body.slice(0, 500) } });
		} catch (err) {
			results.push({ step: 'create_return', ok: false, detail: err instanceof Error ? err.message : String(err) });
		}
	} else {
		results.push({ step: 'create_return', ok: true, detail: 'Already exists' });
	}

	const allOk = results.every(r => r.ok);
	return json({ ok: allOk, results });
};
