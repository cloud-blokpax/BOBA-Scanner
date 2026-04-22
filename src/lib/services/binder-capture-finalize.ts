/**
 * At-shutter finalizer for binder-mode captures.
 *
 * Per non-blank cell: runs `runCanonicalTier1` (same region→full-frame
 * two-stage pipeline the single-card path uses at 2.1a), compares the
 * result against the pre-shutter live consensus, and returns rows ready
 * for persistence OR a Haiku fallback flag.
 *
 * CRITICAL invariant: every `parallel` field on the return value is
 * already mapped to a human-readable name via WONDERS_PARALLEL_NAMES
 * (that mapping happens inside `runCanonicalTier1`). Short classifier
 * codes ('paper', 'cf', 'ff', 'ocm', 'sf') are NOT permitted downstream.
 * `binder-persistence.ts` asserts this on the way to the DB.
 */

import { runCanonicalTier1 } from './tier1-canonical';
import {
	computeCellRegions,
	extractCellBitmap,
	type GridSize
} from './cell-extractor';
import { isCellBlank } from './blank-cell-detector';
import type { BinderSnapshot, BinderSnapshotCell } from './binder-coordinator';
import type { MirrorCard } from './catalog-mirror';
import { toParallelName } from '$lib/data/wonders-parallels';

export interface FinalizedCell {
	row: number;
	col: number;
	isBlank: boolean;
	card: MirrorCard | null;
	cardId: string | null;
	cardNumber: string | null;
	name: string | null;
	/** Human-readable parallel name; NEVER a classifier short code. */
	parallel: string | null;
	confidence: number;
	liveConsensusReached: boolean;
	liveVsCanonicalAgreed: boolean | null;
	fallbackTierUsed: 'none' | 'haiku' | 'sonnet' | 'manual' | null;
	ocrStrategy: 'region' | 'full_frame' | 'mixed' | null;
	decisionContext: Record<string, unknown>;
}

const CELL_CONFIDENCE_FLOOR = 0.6;

export async function finalizeBinderCapture(
	capturedFrame: ImageBitmap,
	gridSize: GridSize,
	game: 'boba' | 'wonders',
	liveSnapshot: BinderSnapshot | null
): Promise<FinalizedCell[]> {
	const regions = computeCellRegions(capturedFrame.width, capturedFrame.height, gridSize);
	const liveByKey = new Map<string, BinderSnapshotCell>();
	if (liveSnapshot) {
		for (const c of liveSnapshot.cells) liveByKey.set(`${c.row}_${c.col}`, c);
	}

	const results: FinalizedCell[] = [];
	for (const region of regions) {
		const key = `${region.row}_${region.col}`;
		const liveCell = liveByKey.get(key);
		const cellBitmap = await extractCellBitmap(capturedFrame, region);

		// Trust pre-shutter blank detection if set; otherwise re-check now.
		const isBlank = liveCell?.isBlank ?? (await isCellBlank(cellBitmap));
		if (isBlank) {
			results.push({
				row: region.row,
				col: region.col,
				isBlank: true,
				card: null,
				cardId: null,
				cardNumber: null,
				name: null,
				parallel: null,
				confidence: 0,
				liveConsensusReached: false,
				liveVsCanonicalAgreed: null,
				fallbackTierUsed: null,
				ocrStrategy: null,
				decisionContext: { source: 'blank_cell_skip' }
			});
			cellBitmap.close();
			continue;
		}

		try {
			const canonical = await runCanonicalTier1(cellBitmap, game);

			const liveReached = liveCell?.consensusReached ?? false;
			let liveAgreed: boolean | null = null;
			if (liveReached && liveCell?.consensus) {
				const liveParallelName = liveCell.consensus.parallel?.value
					? toParallelName(liveCell.consensus.parallel.value)
					: null;
				liveAgreed = !!(
					liveCell.consensus.cardNumber?.value === canonical.cardNumber &&
					liveCell.consensus.name?.value === canonical.name &&
					(game === 'boba' || liveParallelName === canonical.parallel)
				);
			}

			const canonicalOk = !!canonical.card && canonical.confidence >= CELL_CONFIDENCE_FLOOR;

			if (canonicalOk) {
				results.push({
					row: region.row,
					col: region.col,
					isBlank: false,
					card: canonical.card,
					cardId: canonical.card?.id ?? null,
					cardNumber: canonical.cardNumber,
					name: canonical.name,
					parallel: canonical.parallel, // already human-readable
					confidence: canonical.confidence,
					liveConsensusReached: liveReached,
					liveVsCanonicalAgreed: liveAgreed,
					fallbackTierUsed: null,
					ocrStrategy: canonical.ocrStrategy,
					decisionContext: {
						canonical_result: canonical.perTask,
						canonical_ocr_strategy: canonical.ocrStrategy,
						live_vs_canonical: {
							live_ran: !!liveCell,
							live_reached: liveReached,
							agreed: liveAgreed
						}
					}
				});
			} else {
				// Canonical below floor — flag for Haiku fallback. The Scanner
				// capture handler routes this to the Haiku path before
				// persistence; cells that still fail after Haiku persist as
				// outcome='pending' for user edit in the review UI.
				results.push({
					row: region.row,
					col: region.col,
					isBlank: false,
					card: null,
					cardId: null,
					cardNumber: canonical.cardNumber,
					name: canonical.name,
					parallel: canonical.parallel,
					confidence: canonical.confidence,
					liveConsensusReached: liveReached,
					liveVsCanonicalAgreed: null,
					fallbackTierUsed: 'haiku',
					ocrStrategy: canonical.ocrStrategy,
					decisionContext: {
						canonical_result: canonical.perTask,
						canonical_ocr_strategy: canonical.ocrStrategy,
						canonical_below_floor: true,
						live_vs_canonical: {
							live_ran: !!liveCell,
							live_reached: liveReached
						}
					}
				});
			}
		} catch (err) {
			results.push({
				row: region.row,
				col: region.col,
				isBlank: false,
				card: null,
				cardId: null,
				cardNumber: null,
				name: null,
				parallel: null,
				confidence: 0,
				liveConsensusReached: liveCell?.consensusReached ?? false,
				liveVsCanonicalAgreed: null,
				fallbackTierUsed: 'haiku',
				ocrStrategy: null,
				decisionContext: { canonical_error: String(err) }
			});
		} finally {
			cellBitmap.close();
		}
	}

	return results;
}
