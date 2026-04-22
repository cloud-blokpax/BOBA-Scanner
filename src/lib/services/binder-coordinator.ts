/**
 * Live pre-shutter orchestrator for binder-mode scanning.
 *
 * Each binder cell gets its own independent ConsensusBuilder running on
 * the same camera frame cycle (~2fps). When the user taps shutter, the
 * per-cell snapshots are the "live hint" compared against the canonical
 * per-cell pass in binder-capture-finalize.
 *
 * Global pixel-stability across the whole frame invalidates ALL cells
 * when the binder page turns — otherwise one cell's consensus would
 * carry over onto a totally different card.
 */

import { ocrRegion, isPaddleOCRReady } from './paddle-ocr';
import { REGIONS, regionToPixels } from './ocr-regions';
import { classifyWondersParallel } from './parallel-classifier';
import { ConsensusBuilder, type Consensus } from './consensus-builder';
import { isCellBlank } from './blank-cell-detector';
import {
	computeCellRegions,
	extractCellBitmap,
	type CellRegion,
	type GridSize
} from './cell-extractor';
import { OCRWorkerPool, deriveMaxConcurrent } from './ocr-worker-pool';
import { makeProbe, correlate, STABILITY_THRESHOLD } from './pixel-stability';

const CYCLE_INTERVAL_MS = 500;
const MAX_CYCLES = 8;

interface CellState {
	region: CellRegion;
	sessionId: number;
	builder: ConsensusBuilder | null;
	isBlank: boolean;
	cyclesRun: number;
}

export interface BinderSnapshotCell {
	row: number;
	col: number;
	isBlank: boolean;
	consensus: Consensus | null;
	consensusReached: boolean;
	cyclesRun: number;
}

export interface BinderSnapshot {
	gridSize: GridSize;
	globalSessionId: number;
	cells: BinderSnapshotCell[];
	msInAlignedState: number;
}

export class BinderCoordinator {
	private gridSize: GridSize = '3x3';
	private cells: Map<string, CellState> = new Map();
	private globalSessionId = 0;
	private alignedSince: number | null = null;
	private cycleTimer: ReturnType<typeof setInterval> | null = null;
	private pool: OCRWorkerPool;
	private game: 'boba' | 'wonders' = 'boba';
	private getBitmapFn: () => ImageBitmap | null = () => null;
	private lastGlobalProbe: Uint8Array | null = null;

	constructor() {
		this.pool = new OCRWorkerPool(deriveMaxConcurrent());
	}

	configure(opts: {
		game: 'boba' | 'wonders';
		gridSize: GridSize;
		getBitmap: () => ImageBitmap | null;
	}) {
		this.game = opts.game;
		this.gridSize = opts.gridSize;
		this.getBitmapFn = opts.getBitmap;
	}

	onAlignmentChanged(state: 'no_card' | 'partial' | 'ready') {
		if (state === 'ready') this.startSession();
		else this.endSession();
	}

	onVisibilityHidden() {
		this.endSession();
	}

	private startSession() {
		this.globalSessionId += 1;
		this.cells.clear();
		const bitmap = this.getBitmapFn();
		if (!bitmap) return;
		const regions = computeCellRegions(bitmap.width, bitmap.height, this.gridSize);
		for (const region of regions) {
			const key = `${region.row}_${region.col}`;
			this.cells.set(key, {
				region,
				sessionId: this.globalSessionId,
				builder: null,
				isBlank: false,
				cyclesRun: 0
			});
		}
		this.alignedSince = performance.now();
		this.lastGlobalProbe = null;
		if (this.cycleTimer) clearInterval(this.cycleTimer);
		this.cycleTimer = setInterval(() => void this.runCycle(), CYCLE_INTERVAL_MS);
	}

	private endSession() {
		if (this.cycleTimer) {
			clearInterval(this.cycleTimer);
			this.cycleTimer = null;
		}
		this.alignedSince = null;
	}

	private async runCycle(): Promise<void> {
		if (!isPaddleOCRReady()) return;
		const frame = this.getBitmapFn();
		if (!frame) return;

		// Global stability: page-turn or camera move invalidates ALL cells.
		const globalProbe = makeProbe(frame);
		if (this.lastGlobalProbe) {
			const corr = correlate(this.lastGlobalProbe, globalProbe);
			if (corr < STABILITY_THRESHOLD) {
				this.startSession();
				return;
			}
		}
		this.lastGlobalProbe = globalProbe;

		for (const [key, cell] of this.cells) {
			if (cell.isBlank) continue;
			if (cell.cyclesRun >= MAX_CYCLES) continue;
			if (cell.builder?.getConsensus().reachedThreshold) continue;

			const cellBitmap = await extractCellBitmap(frame, cell.region);

			// Blank check on first visit. Fail-open — uncertain stays non-blank.
			if (cell.cyclesRun === 0) {
				const blank = await isCellBlank(cellBitmap);
				if (blank) {
					cell.isBlank = true;
					cellBitmap.close();
					continue;
				}
			}

			this.pool
				.submit(key, async () => {
					try {
						await this.processCellFrame(cell, cellBitmap);
					} finally {
						cellBitmap.close();
					}
				})
				.catch((err) => {
					if ((err as Error).message !== 'superseded') {
						console.debug(`[binder] cell ${key} OCR failed`, err);
					}
				});
		}
	}

	/**
	 * Per-cell region OCR. Note that minWidth is smaller than the single-card
	 * path (600/800 vs 800/1000) because the cell bitmap is already a fraction
	 * of the full frame; scaling it further doesn't recover information that
	 * wasn't captured.
	 */
	private async processCellFrame(cell: CellState, cellBitmap: ImageBitmap): Promise<void> {
		if (!cell.builder) {
			cell.builder = new ConsensusBuilder(cell.sessionId, this.game);
		}
		const regions = this.game === 'boba' ? REGIONS.boba : REGIONS.wonders;
		const cardNumReg = regionToPixels(regions.card_number, cellBitmap.width, cellBitmap.height);
		const nameReg = regionToPixels(
			this.game === 'boba' ? REGIONS.boba.hero_name : REGIONS.wonders.card_name,
			cellBitmap.width,
			cellBitmap.height
		);

		const [numRes, nameRes, parallelRes] = await Promise.allSettled([
			ocrRegion(cellBitmap, cardNumReg, { minWidth: 600 }),
			ocrRegion(cellBitmap, nameReg, { minWidth: 800 }),
			this.game === 'wonders' ? classifyWondersParallel(cellBitmap) : Promise.resolve(null)
		]);

		if (numRes.status === 'fulfilled' && numRes.value.text) {
			cell.builder.addVote({
				task: 'card_number',
				rawValue: numRes.value.text,
				confidence: numRes.value.confidence,
				sessionId: cell.sessionId
			});
		}
		if (nameRes.status === 'fulfilled' && nameRes.value.text) {
			cell.builder.addVote({
				task: 'name',
				rawValue: nameRes.value.text,
				confidence: nameRes.value.confidence,
				sessionId: cell.sessionId
			});
		}
		if (parallelRes.status === 'fulfilled' && parallelRes.value) {
			cell.builder.addVote({
				task: 'parallel',
				rawValue: parallelRes.value.parallel,
				confidence: parallelRes.value.confidence,
				sessionId: cell.sessionId
			});
		}
		cell.builder.tickFrame();
		cell.cyclesRun++;
	}

	snapshot(): BinderSnapshot {
		return {
			gridSize: this.gridSize,
			globalSessionId: this.globalSessionId,
			cells: Array.from(this.cells.values()).map((cell) => ({
				row: cell.region.row,
				col: cell.region.col,
				isBlank: cell.isBlank,
				consensus: cell.builder?.getConsensus() ?? null,
				consensusReached: cell.builder?.getConsensus().reachedThreshold ?? false,
				cyclesRun: cell.cyclesRun
			})),
			msInAlignedState: this.alignedSince ? performance.now() - this.alignedSince : 0
		};
	}

	reset() {
		this.endSession();
		this.cells.clear();
		this.globalSessionId = 0;
	}
}

export const binderCoordinator = new BinderCoordinator();
