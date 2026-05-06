/**
 * GET  /api/admin/filter-health             — list view
 * GET  /api/admin/filter-health?card_id=... — drawer detail (samples)
 *
 * Reads from mv_filter_health (refreshed daily by mark-stale-listings cron)
 * for the list view, and from ebay_listing_observations (live, indexed by
 * card_id) for the drawer detail.
 *
 * Admin-only.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import { apiError, serviceUnavailable } from '$lib/server/api-response';

export const config = { maxDuration: 30 };

interface FilterHealthRow {
	card_id: string;
	game_id: string;
	hero_name: string | null;
	name: string;
	card_number: string | null;
	parallel: string | null;
	weapon_type: string | null;
	total_obs: number;
	accepted: number;
	rejected: number;
	accept_pct: number;
	identity_rejects: number;
	weapon_rejects: number;
	parallel_rejects: number;
	hard_rejects: number;
	anchor_rejects: number;
	wonders_anchor_rejects: number;
	boba_contamination_rejects: number;
	bulk_lot_rejects: number;
	missing_title_rejects: number;
	top_rejection: string | null;
	last_observed: string;
}

interface SampleRow {
	bucket: 'rejected' | 'accepted';
	observed_at: string;
	ebay_item_id: string;
	title: string;
	price_value: number | null;
	condition_label: string | null;
	rejection_reason: string | null;
	weapon_conflict: boolean;
	item_web_url: string | null;
}

const ALLOWED_SORTS = new Set(['accept_pct_asc', 'total_obs_desc', 'last_observed_desc']);
const ALLOWED_GAMES = new Set(['boba', 'wonders']);

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) return serviceUnavailable('Supabase admin');

	const cardIdParam = url.searchParams.get('card_id');

	// Drawer mode — return samples for one card.
	if (cardIdParam) {
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardIdParam)) {
			return apiError('invalid card_id', 400);
		}

		const { data, error } = await (
			admin.rpc as unknown as (
				name: 'get_filter_health_samples',
				args: { p_card_id: string; p_rejected_limit?: number; p_accepted_limit?: number }
			) => Promise<{ data: SampleRow[] | null; error: { message: string } | null }>
		)('get_filter_health_samples', {
			p_card_id: cardIdParam,
			p_rejected_limit: 25,
			p_accepted_limit: 10
		});

		if (error) {
			console.error('[filter-health] samples RPC failed:', error.message);
			return apiError('failed to load samples', 500);
		}

		const samples = data ?? [];
		return json({
			rejected: samples.filter((s) => s.bucket === 'rejected'),
			accepted: samples.filter((s) => s.bucket === 'accepted')
		});
	}

	// List mode.
	const minObs = Number(url.searchParams.get('min_obs') ?? '10');
	const maxAcceptPct = Number(url.searchParams.get('max_accept_pct') ?? '100');
	const game = url.searchParams.get('game');
	const sort = url.searchParams.get('sort') ?? 'accept_pct_asc';
	const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 200);
	const offset = Number(url.searchParams.get('offset') ?? '0');

	if (!Number.isFinite(minObs) || minObs < 1) return apiError('invalid min_obs', 400);
	if (!Number.isFinite(maxAcceptPct) || maxAcceptPct < 0 || maxAcceptPct > 100) {
		return apiError('invalid max_accept_pct', 400);
	}
	if (!ALLOWED_SORTS.has(sort)) return apiError('invalid sort', 400);
	if (game && !ALLOWED_GAMES.has(game)) return apiError('invalid game', 400);

	const { data, error } = await (
		admin.rpc as unknown as (
			name: 'get_filter_health',
			args: {
				p_min_obs: number;
				p_max_accept_pct: number;
				p_game_id: string | null;
				p_sort: string;
				p_limit: number;
				p_offset: number;
			}
		) => Promise<{ data: FilterHealthRow[] | null; error: { message: string } | null }>
	)('get_filter_health', {
		p_min_obs: Math.floor(minObs),
		p_max_accept_pct: maxAcceptPct,
		p_game_id: game,
		p_sort: sort,
		p_limit: limit,
		p_offset: offset
	});

	if (error) {
		console.error('[filter-health] list RPC failed:', error.message);
		return apiError('failed to load filter health', 500);
	}

	// Refresh metadata — read top row's refreshed_at via a tiny separate query
	// (the RPC doesn't return MV-level metadata).
	const { data: metaData } = (await (
		admin
			.from('mv_filter_health')
			.select('refreshed_at')
			.order('refreshed_at', { ascending: false })
			.limit(1) as unknown as Promise<{
			data: Array<{ refreshed_at: string }> | null;
		}>
	));

	return json({
		rows: data ?? [],
		refreshedAt: metaData?.[0]?.refreshed_at ?? null,
		filters: { minObs, maxAcceptPct, game, sort, limit, offset }
	});
};
