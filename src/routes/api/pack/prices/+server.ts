/**
 * POST /api/pack/prices — Bulk price lookup from price_cache.
 *
 * Reads only. Never calls eBay. Used by:
 *   - /packs page to show real $ on opened packs
 *   - /packs/ev Monte Carlo (server-to-server via internal import, not HTTP)
 *
 * Request body: { cardIds: string[] }
 * Response:     { prices: Record<string, number> } — card_id → price_mid
 *
 * Unpriced cards are omitted from the response (not set to 0). Caller should
 * treat missing entries as "no market data."
 */

import { json, error } from '@sveltejs/kit';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkAnonPriceRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 10 };

const MAX_CARD_IDS = 2000;

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const { user } = await locals.safeGetSession();

	if (!user) {
		const rateLimit = await checkAnonPriceRateLimit(getClientAddress());
		if (!rateLimit.success) {
			return json({ error: 'Rate limited' }, { status: 429 });
		}
	}

	let body: { cardIds?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	if (!Array.isArray(body.cardIds)) throw error(400, 'cardIds must be an array');
	if (body.cardIds.length === 0) return json({ prices: {} });
	if (body.cardIds.length > MAX_CARD_IDS) {
		throw error(400, `Too many cardIds (max ${MAX_CARD_IDS})`);
	}

	const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const heroIds: string[] = [];
	const playIds: string[] = [];
	for (const id of body.cardIds) {
		if (typeof id !== 'string') continue;
		if (UUID_RE.test(id)) heroIds.push(id);
		else playIds.push(id);
	}

	const admin = getAdminClient() || locals.supabase;
	if (!admin) throw error(503, 'Database unavailable');

	const prices: Record<string, number> = {};

	if (heroIds.length > 0) {
		// Pack EV always uses Paper prices — packs are factory-fresh, never foil.
		const { data, error: err } = await admin
			.from('price_cache')
			.select('card_id, price_mid')
			.eq('source', 'ebay')
			.eq('parallel', 'Paper')
			.in('card_id', heroIds)
			.not('price_mid', 'is', null);
		if (err) {
			console.error('[api/pack/prices] price_cache query error:', err);
			throw error(500, 'Price lookup failed');
		}
		for (const row of data ?? []) {
			if (row.card_id && row.price_mid !== null) {
				prices[row.card_id as string] = Number(row.price_mid);
			}
		}
	}

	if (playIds.length > 0) {
		const { data, error: err } = await admin
			.from('play_price_cache')
			.select('card_id, price_mid')
			.eq('source', 'ebay')
			.in('card_id', playIds)
			.not('price_mid', 'is', null);
		if (err) {
			console.error('[api/pack/prices] play_price_cache query error:', err);
		} else {
			for (const row of data ?? []) {
				if (row.card_id && row.price_mid !== null) {
					prices[row.card_id as string] = Number(row.price_mid);
				}
			}
		}
	}

	return json({ prices });
};
