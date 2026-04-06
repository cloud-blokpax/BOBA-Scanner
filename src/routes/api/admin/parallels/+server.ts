/**
 * Admin API for parallel rarity configuration.
 *
 * PUT  /api/admin/parallels — upsert a single parallel's rarity
 * POST /api/admin/parallels — seed missing parallels into the config table
 *
 * Both endpoints require admin auth and write via service-role client
 * to bypass RLS (the parallel_rarity_config table no longer allows
 * writes from the authenticated role).
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { parseJsonBody, requireString } from '$lib/server/validate';
import { getAdminClient } from '$lib/server/supabase-admin';
import { checkMutationRateLimit } from '$lib/server/rate-limit';
import { PARALLEL_TYPES } from '$lib/data/boba-parallels';
import { mapParallelToRarity } from '$lib/services/parallel-config';
import type { CardRarity } from '$lib/types';
import type { RequestHandler } from './$types';

const VALID_RARITIES: CardRarity[] = ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary'];

function defaultRarityForParallel(key: string): CardRarity {
	if (key === 'base' || key === 'battlefoil') return 'common';
	if (key === 'super_parallel') return 'legendary';
	if (key === 'inspired_ink') return 'ultra_rare';
	if (key.includes('battlefoil')) return 'rare';
	return 'uncommon';
}

/** PUT — update a single parallel's rarity */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const user = await requireAdmin(locals);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const body = await parseJsonBody(request);
	const parallel_name = requireString(body.parallel_name, 'parallel_name', 100);
	const rarity = requireString(body.rarity, 'rarity', 20) as CardRarity;

	if (!VALID_RARITIES.includes(rarity)) {
		throw error(400, `Invalid rarity. Must be one of: ${VALID_RARITIES.join(', ')}`);
	}

	const adminClient = getAdminClient();
	if (!adminClient) throw error(503, 'Admin client not configured');

	const { error: dbError } = await adminClient
		.from('parallel_rarity_config')
		.upsert(
			{
				parallel_name,
				rarity,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'parallel_name' }
		);

	if (dbError) {
		console.error('[admin/parallels] Upsert error:', dbError);
		throw error(500, 'Failed to update parallel config');
	}

	return json({ success: true });
};

/** POST — seed missing parallels from PARALLEL_TYPES + cards table */
export const POST: RequestHandler = async ({ locals }) => {
	const user = await requireAdmin(locals);

	const rateLimit = await checkMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many requests' }, { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit.limit), 'X-RateLimit-Remaining': String(rateLimit.remaining), 'X-RateLimit-Reset': String(rateLimit.reset) } });
	}

	const adminClient = getAdminClient();
	if (!adminClient) throw error(503, 'Admin client not configured');

	// Get already-configured parallels
	const { data: existingData } = await adminClient
		.from('parallel_rarity_config')
		.select('parallel_name');
	const existingNames = new Set(
		(existingData || []).map((e: { parallel_name: string }) => e.parallel_name.toLowerCase())
	);

	const toSeed = new Map<string, { name: string; rarity: CardRarity }>();

	// Add all from PARALLEL_TYPES
	for (const pt of PARALLEL_TYPES) {
		if (!existingNames.has(pt.name.toLowerCase()) && !existingNames.has(pt.key)) {
			toSeed.set(pt.name.toLowerCase(), {
				name: pt.name,
				rarity: defaultRarityForParallel(pt.key)
			});
		}
	}

	// Discover from cards table
	const { data: cardData } = await adminClient
		.from('cards')
		.select('parallel')
		.not('parallel', 'is', null)
		.limit(20000);

	if (cardData) {
		for (const row of cardData) {
			const p = row.parallel as string;
			if (p && !existingNames.has(p.toLowerCase()) && !toSeed.has(p.toLowerCase())) {
				toSeed.set(p.toLowerCase(), {
					name: p,
					rarity: mapParallelToRarity(p) || 'common'
				});
			}
		}
	}

	if (toSeed.size === 0) {
		return json({ success: true, seeded: 0 });
	}

	const baseOrder = (existingData || []).length;
	const rows = [...toSeed.values()].map((entry, i) => ({
		parallel_name: entry.name,
		rarity: entry.rarity,
		sort_order: baseOrder + i
	}));

	const { error: insertError } = await adminClient
		.from('parallel_rarity_config')
		.insert(rows);

	if (insertError) {
		console.error('[admin/parallels] Seed error:', insertError);
		throw error(500, 'Failed to seed parallels');
	}

	return json({ success: true, seeded: rows.length });
};
