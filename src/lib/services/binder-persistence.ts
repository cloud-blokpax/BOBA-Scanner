/**
 * Persists a binder-mode capture as one parent `scans` row (representing
 * the whole binder page) plus N child rows (one per non-blank cell),
 * linked via `parent_scan_id`.
 *
 * IMPORTANT invariant: `cellResults[i].parallel` MUST already be a
 * human-readable string (from `WONDERS_PARALLEL_NAMES` for Wonders or
 * `cards.parallel` for BoBA). Short codes ('paper'|'cf'|'ff'|'ocm'|'sf')
 * MUST NOT reach this function. `finalizeBinderCapture` is responsible
 * for that mapping; this function guards the DB write with an explicit
 * assertion.
 */

import { getSupabase } from './supabase';
import { getOrOpenActiveSession } from './scan-writer';
import { PIPELINE_VERSION } from './pipeline-version';
import type { FinalizedCell } from './binder-capture-finalize';
import { assertHumanReadableParallel as assertShared } from '$lib/data/wonders-parallels';

export interface BinderScanResult {
	parentScanId: string;
	childScanIds: string[];
}

/**
 * Regression guard wrapper: the actual assertion lives in
 * `$lib/data/wonders-parallels` (`assertHumanReadableParallel`). We wrap it
 * so binder callers get the row/col context baked into the error message.
 */
function assertHumanReadableParallel(row: number, col: number, parallel: string | null): void {
	assertShared(parallel, `persistBinderScan cell(${row},${col}) final_parallel`);
}

export async function persistBinderScan(opts: {
	userId: string;
	gameId: 'boba' | 'wonders';
	gridSize: string;
	parentPhotoPath: string | null;
	cellResults: FinalizedCell[];
}): Promise<BinderScanResult | null> {
	const client = getSupabase();
	if (!client) return null;

	const sessionId = await getOrOpenActiveSession({ gameId: opts.gameId });
	if (!sessionId) return null;

	const nonBlank = opts.cellResults.filter((c) => !c.isBlank);

	// Assert BEFORE any insert so one bad cell never lands a partial parent row.
	for (const c of nonBlank) {
		assertHumanReadableParallel(c.row, c.col, c.parallel);
	}

	// Parent row — represents the whole binder capture.
	const { data: parent, error: parentErr } = await client
		.from('scans')
		.insert({
			session_id: sessionId,
			user_id: opts.userId,
			game_id: opts.gameId,
			capture_source: 'camera_live',
			photo_storage_path: opts.parentPhotoPath,
			outcome: 'resolved',
			pipeline_version: PIPELINE_VERSION,
			capture_context: {
				binder_grid_size: opts.gridSize,
				child_scan_count: nonBlank.length,
				cells_total: opts.cellResults.length,
				cells_blank: opts.cellResults.length - nonBlank.length,
				cells_with_consensus: nonBlank.filter((c) => c.liveConsensusReached).length,
				cells_with_canonical_agreement: nonBlank.filter((c) => c.liveVsCanonicalAgreed === true)
					.length,
				cells_needing_fallback: nonBlank.filter((c) => c.fallbackTierUsed === 'haiku').length
			}
		})
		.select('id')
		.single();

	if (parentErr || !parent) {
		console.debug('[binder-persistence] parent insert failed', parentErr);
		return null;
	}

	// Child rows — one per non-blank cell.
	const childRows = nonBlank.map((c) => ({
		session_id: sessionId,
		user_id: opts.userId,
		game_id: opts.gameId,
		parent_scan_id: parent.id,
		capture_source: 'binder_live_cell',
		final_card_id: c.cardId,
		final_parallel: c.parallel,
		final_confidence: c.confidence,
		live_consensus_reached: c.liveConsensusReached,
		live_vs_canonical_agreed: c.liveVsCanonicalAgreed,
		fallback_tier_used: c.fallbackTierUsed,
		outcome: (c.cardId ? 'resolved' : 'pending') as 'resolved' | 'pending',
		pipeline_version: PIPELINE_VERSION,
		capture_context: {
			binder_cell_row: c.row,
			binder_cell_col: c.col,
			binder_grid_size: opts.gridSize
		},
		decision_context: c.decisionContext
	}));

	if (childRows.length === 0) {
		return { parentScanId: parent.id, childScanIds: [] };
	}

	const { data: children, error: childrenErr } = await client
		.from('scans')
		.insert(childRows)
		.select('id');

	if (childrenErr) {
		console.debug('[binder-persistence] children insert failed', childrenErr);
		return { parentScanId: parent.id, childScanIds: [] };
	}

	return {
		parentScanId: parent.id,
		childScanIds: (children ?? []).map((c) => c.id)
	};
}
