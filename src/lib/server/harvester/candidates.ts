/**
 * Harvester candidate selection.
 *
 * Wraps the two RPCs that pick the next batch of cards/plays for the eBay
 * price harvester to refresh. Lifted out of price-harvest/+server.ts so the
 * route file stays focused on chain orchestration.
 *
 * Phase 2.5: the BoBA RPC returns (id, parallel, ...) pairs drawn from the
 * union of parallels seen in active collections / listing_templates plus
 * cards.parallel as the baseline. card_parallel_name is the rich per-card
 * parallel name (e.g. "Battlefoil") and is preferred over the synthetic
 * `parallel` column for downstream eBay queries and writes.
 */

import { logEvent } from '$lib/server/diagnostics';
import type { getAdminClient } from '$lib/server/supabase-admin';

export interface CardCandidate {
	id: string;
	hero_name: string | null;
	name: string | null;
	card_number: string | null;
	athlete_name: string | null;
	/** cards.parallel — the rich per-card parallel name (e.g. "Battlefoil"). */
	card_parallel_name?: string | null;
	weapon_type: string | null;
	priority: number;
	/** Downstream parallel column value. For BoBA equals card_parallel_name
	 *  (post-backfill); for Wonders is the active foil parallel name. */
	parallel?: string | null;
	/** Phase 3: game_id routes to the right query builder (BoBA vs Wonders). */
	game_id?: string | null;
	/** Phase 3: metadata used by the Wonders query builder for set display name. */
	metadata?: Record<string, unknown> | null;
}

type AdminClient = NonNullable<ReturnType<typeof getAdminClient>>;

export async function getNextCandidates(
	admin: AdminClient,
	limit: number,
	today: string,
	gameId: 'boba' | 'wonders' = 'boba'
): Promise<CardCandidate[]> {
	const rpcArgs = {
		p_run_id: today,
		p_limit: limit,
		p_game_id: gameId,
	} as unknown as { p_run_id: string; p_limit: number };

	const { data, error: rpcError } = await admin.rpc('get_harvest_candidates', rpcArgs);

	if (rpcError) {
		console.error(`[harvest] get_harvest_candidates RPC failed (game=${gameId}):`, rpcError);
		void logEvent({
			level: 'error',
			event: 'harvest.boba.candidates_rpc_failed',
			error: rpcError.message,
			errorCode: rpcError.code,
			context: { game_id: gameId }
		});
		return [];
	}

	const raw = (data as unknown as CardCandidate[]) || [];
	return raw.map((r) => ({
		...r,
		parallel: r.card_parallel_name || r.parallel || 'paper',
		game_id: r.game_id || gameId
	}));
}

export async function getPlayCandidates(
	admin: AdminClient,
	limit: number
): Promise<CardCandidate[]> {
	const { data, error: rpcError } = await admin.rpc('get_play_harvest_candidates', {
		p_limit: limit
	});

	if (rpcError) {
		console.error('[harvest] get_play_harvest_candidates RPC failed:', rpcError);
		void logEvent({
			level: 'error',
			event: 'harvest.play.candidates_rpc_failed',
			error: rpcError.message,
			errorCode: rpcError.code
		});
		return [];
	}

	return (data as unknown as CardCandidate[]) || [];
}
