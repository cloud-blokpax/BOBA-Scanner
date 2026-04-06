/**
 * GET /api/ebay/diagnose — Step-by-step eBay integration diagnostic
 *
 * Admin-only. Tests each step of the create-draft flow in isolation
 * so you can pinpoint exactly where the failure occurs.
 */

import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getSellerToken, isSellerConnected, isSellerOAuthConfigured } from '$lib/server/ebay-seller-auth';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const EBAY_INVENTORY_URL = 'https://api.ebay.com/sell/inventory/v1';
const EBAY_ACCOUNT_URL = 'https://api.ebay.com/sell/account/v1';

interface StepResult {
	step: string;
	ok: boolean;
	ms: number;
	detail?: unknown;
	error?: string;
}

async function timed<T>(name: string, fn: () => Promise<T>): Promise<StepResult & { value?: T }> {
	const start = Date.now();
	try {
		const value = await fn();
		return { step: name, ok: true, ms: Date.now() - start, value };
	} catch (err) {
		return {
			step: name,
			ok: false,
			ms: Date.now() - start,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	const user = await requireAdmin(locals);
	const results: StepResult[] = [];

	// Step 1: OAuth configured?
	const oauthConfigured = isSellerOAuthConfigured();
	results.push({ step: '1_oauth_configured', ok: oauthConfigured, ms: 0, detail: { configured: oauthConfigured } });
	if (!oauthConfigured) return json({ results });

	// Step 2: Seller connected?
	const connStep = await timed('2_seller_connected', () => isSellerConnected(user.id));
	results.push({ ...connStep, detail: { connected: connStep.value } });
	if (!connStep.ok || !connStep.value) return json({ results });

	// Step 3: Get seller token
	const tokenStep = await timed('3_get_seller_token', () => getSellerToken(user.id));
	const tokenPreview = tokenStep.value ? `${tokenStep.value.slice(0, 8)}...${tokenStep.value.slice(-4)}` : null;
	results.push({ ...tokenStep, detail: { hasToken: !!tokenStep.value, preview: tokenPreview } });
	if (!tokenStep.ok || !tokenStep.value) return json({ results });

	const token = tokenStep.value;
	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
		'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
	};

	// Step 4: Test privilege endpoint (lightweight auth check)
	const privStep = await timed('4_privilege_check', async () => {
		const res = await fetch('https://api.ebay.com/sell/account/v1/privilege', { headers });
		const body = await res.text();
		return { status: res.status, body: body.slice(0, 500) };
	});
	results.push({ ...privStep, detail: privStep.value });

	// Step 5: Fetch fulfillment policies
	const fulfillStep = await timed('5_fulfillment_policies', async () => {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/fulfillment_policy?marketplace_id=EBAY_US`, { headers });
		const body = await res.json();
		return {
			status: res.status,
			count: body.fulfillmentPolicies?.length ?? 0,
			policies: body.fulfillmentPolicies?.map((p: Record<string, unknown>) => ({
				id: p.fulfillmentPolicyId,
				name: p.name
			})) ?? [],
			errors: body.errors ?? null
		};
	});
	results.push({ ...fulfillStep, detail: fulfillStep.value });

	// Step 6: Fetch payment policies
	const payStep = await timed('6_payment_policies', async () => {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/payment_policy?marketplace_id=EBAY_US`, { headers });
		const body = await res.json();
		return {
			status: res.status,
			count: body.paymentPolicies?.length ?? 0,
			policies: body.paymentPolicies?.map((p: Record<string, unknown>) => ({
				id: p.paymentPolicyId,
				name: p.name
			})) ?? [],
			errors: body.errors ?? null
		};
	});
	results.push({ ...payStep, detail: payStep.value });

	// Step 7: Fetch return policies
	const retStep = await timed('7_return_policies', async () => {
		const res = await fetch(`${EBAY_ACCOUNT_URL}/return_policy?marketplace_id=EBAY_US`, { headers });
		const body = await res.json();
		return {
			status: res.status,
			count: body.returnPolicies?.length ?? 0,
			policies: body.returnPolicies?.map((p: Record<string, unknown>) => ({
				id: p.returnPolicyId,
				name: p.name
			})) ?? [],
			errors: body.errors ?? null
		};
	});
	results.push({ ...retStep, detail: retStep.value });

	// Step 8: Test inventory item creation with a dummy SKU
	const testSku = `BOBA-DIAG-${Date.now()}`;
	const invStep = await timed('8_test_inventory_item', async () => {
		const inventoryItem = {
			product: {
				title: 'BOBA Diagnostic Test - DELETE ME',
				description: '<p>Diagnostic test item. Safe to delete.</p>',
				aspects: {
					'Card Name': ['Diagnostic'],
					'Set': ['Test'],
					'Sport': ['Multi-Sport'],
					'Card Manufacturer': ['Bo Jackson Battle Arena']
				}
			},
			condition: '4000',
			availability: { shipToLocationAvailability: { quantity: 1 } }
		};

		const res = await fetch(`${EBAY_INVENTORY_URL}/inventory_item/${encodeURIComponent(testSku)}`, {
			method: 'PUT',
			headers: { ...headers, 'Content-Language': 'en-US' },
			body: JSON.stringify(inventoryItem)
		});

		const body = await res.text();
		return { status: res.status, body: body.slice(0, 1000) };
	});
	results.push({ ...invStep, detail: invStep.value });

	// Step 9: Clean up test inventory item
	if (invStep.ok && (invStep.value as { status: number })?.status < 300) {
		const cleanupStep = await timed('9_cleanup_test_item', async () => {
			const res = await fetch(`${EBAY_INVENTORY_URL}/inventory_item/${encodeURIComponent(testSku)}`, {
				method: 'DELETE',
				headers
			});
			return { status: res.status };
		});
		results.push({ ...cleanupStep, detail: cleanupStep.value });
	}

	const totalMs = results.reduce((s, r) => s + r.ms, 0);
	const allOk = results.every(r => r.ok);

	return json({ ok: allOk, totalMs, results });
};
