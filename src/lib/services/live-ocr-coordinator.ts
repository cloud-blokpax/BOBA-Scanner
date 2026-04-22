/**
 * Drives OCR cycles during the viewfinder's "ready" alignment state.
 * Manages a sessionId stamped on each vote so stale results from a prior
 * card never pollute the current session. Four-layer wire-crossing defense:
 *
 *  1. Alignment gating — no cycles unless alignment == 'ready'
 *  2. sessionId stamping — all votes tagged; stale votes dropped
 *  3. Pixel stability probe — mid-ready card swaps start a new session
 *  4. Canonical verification (runs outside this module in recognition.ts)
 */

import { ocrRegion, isPaddleOCRReady } from './paddle-ocr';
import { REGIONS, regionToPixels } from './ocr-regions';
import { classifyWondersParallel } from './parallel-classifier';
import { ConsensusBuilder, type Consensus } from './consensus-builder';
import { makeProbe, correlate, STABILITY_THRESHOLD } from './pixel-stability';

const CYCLE_INTERVAL_MS = 500; // 2fps
const MAX_CYCLES_PER_SESSION = 8;
const RATE_LIMIT_MIN_INTERVAL_MS = 400; // hard ceiling

type AlignmentState = 'no_card' | 'partial' | 'ready';

export interface LiveOCRSnapshot {
	sessionId: number;
	consensus: Consensus | null;
	framesDispatched: number;
	cyclesRun: number;
	sessionIdChanges: number;
	msInAlignedState: number;
	pixelStabilityScores: number[];
}

const DEBUG =
	typeof import.meta !== 'undefined' &&
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	((import.meta as any).env?.VITE_DEBUG_LIVE_OCR === 'true' ||
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(import.meta as any).env?.DEBUG_LIVE_OCR === 'true');

export class LiveOCRCoordinator {
	private sessionId = 0;
	private sessionIdChanges = 0;
	private alignmentState: AlignmentState = 'no_card';
	private alignedSince: number | null = null;
	private currentBuilder: ConsensusBuilder | null = null;
	private lastProbe: Uint8Array | null = null;
	private pixelStabilityScores: number[] = [];
	private cyclesRun = 0;
	private framesDispatched = 0;
	private inFlight = false;
	private lastCycleAt = 0;
	private cycleTimer: ReturnType<typeof setInterval> | null = null;
	private game: 'boba' | 'wonders' = 'boba';
	private getBitmapFn: () => ImageBitmap | null = () => null;

	configure(opts: { game: 'boba' | 'wonders'; getBitmap: () => ImageBitmap | null }) {
		this.game = opts.game;
		this.getBitmapFn = opts.getBitmap;
	}

	onAlignmentChanged(next: AlignmentState) {
		const prev = this.alignmentState;
		this.alignmentState = next;
		if (prev !== 'ready' && next === 'ready') this.startSession();
		else if (prev === 'ready' && next !== 'ready') this.endSession();
	}

	onVisibilityHidden() {
		this.endSession();
	}

	private startSession() {
		this.sessionId += 1;
		this.sessionIdChanges += 1;
		this.currentBuilder = new ConsensusBuilder(this.sessionId, this.game);
		this.lastProbe = null;
		this.pixelStabilityScores = [];
		this.cyclesRun = 0;
		this.framesDispatched = 0;
		this.alignedSince = performance.now();
		if (this.cycleTimer) clearInterval(this.cycleTimer);
		this.cycleTimer = setInterval(() => void this.runCycle(), CYCLE_INTERVAL_MS);
		if (DEBUG) console.debug('[live-ocr] session start', this.sessionId);
		void this.runCycle(); // kick off immediately
	}

	private endSession() {
		if (this.cycleTimer) {
			clearInterval(this.cycleTimer);
			this.cycleTimer = null;
		}
		this.alignedSince = null;
		if (DEBUG) console.debug('[live-ocr] session end', this.sessionId);
	}

	private async runCycle(): Promise<void> {
		if (!isPaddleOCRReady() || !this.currentBuilder || this.inFlight) return;
		if (this.cyclesRun >= MAX_CYCLES_PER_SESSION) {
			this.endSession();
			return;
		}
		const now = performance.now();
		if (now - this.lastCycleAt < RATE_LIMIT_MIN_INTERVAL_MS) return;
		const bitmap = this.getBitmapFn();
		if (!bitmap) return;

		const probe = makeProbe(bitmap);
		if (this.lastProbe) {
			const corr = correlate(this.lastProbe, probe);
			this.pixelStabilityScores.push(corr);
			if (corr < STABILITY_THRESHOLD) {
				// Card changed within aligned state — start new session silently
				if (DEBUG)
					console.debug(
						'[live-ocr] pixel instability',
						corr.toFixed(2),
						'- restarting session'
					);
				this.startSession();
				this.lastProbe = probe;
				return;
			}
		}
		this.lastProbe = probe;

		this.inFlight = true;
		this.lastCycleAt = now;
		const dispatchedSessionId = this.sessionId;
		try {
			const regions = this.game === 'boba' ? REGIONS.boba : REGIONS.wonders;
			const cardNumberReg = regionToPixels(regions.card_number, bitmap.width, bitmap.height);
			const nameReg = regionToPixels(
				this.game === 'boba' ? REGIONS.boba.hero_name : REGIONS.wonders.card_name,
				bitmap.width,
				bitmap.height
			);

			const [numRes, nameRes, parallelRes] = await Promise.allSettled([
				ocrRegion(bitmap, cardNumberReg, { minWidth: 800 }),
				ocrRegion(bitmap, nameReg, { minWidth: 1000 }),
				this.game === 'wonders' ? classifyWondersParallel(bitmap) : Promise.resolve(null)
			]);

			// Guard: session might have been invalidated while OCR was running
			if (this.sessionId !== dispatchedSessionId || !this.currentBuilder) return;

			if (numRes.status === 'fulfilled' && numRes.value.text) {
				this.currentBuilder.addVote({
					task: 'card_number',
					rawValue: numRes.value.text,
					confidence: numRes.value.confidence,
					sessionId: dispatchedSessionId
				});
			}
			if (nameRes.status === 'fulfilled' && nameRes.value.text) {
				this.currentBuilder.addVote({
					task: 'name',
					rawValue: nameRes.value.text,
					confidence: nameRes.value.confidence,
					sessionId: dispatchedSessionId
				});
			}
			if (parallelRes.status === 'fulfilled' && parallelRes.value) {
				// Classifier emits a short code; mapping to the human-readable
				// DB name happens at the write boundary (tier1-canonical.ts).
				this.currentBuilder.addVote({
					task: 'parallel',
					rawValue: parallelRes.value.parallel,
					confidence: parallelRes.value.confidence,
					sessionId: dispatchedSessionId
				});
			}
			this.currentBuilder.tickFrame();
			this.framesDispatched++;
			this.cyclesRun++;
			if (DEBUG) {
				const c = this.currentBuilder.getConsensus();
				console.debug('[live-ocr] cycle', this.cyclesRun, {
					cn: c.cardNumber?.value,
					name: c.name?.value,
					parallel: c.parallel?.value,
					reached: c.reachedThreshold
				});
			}
		} finally {
			this.inFlight = false;
		}
	}

	snapshot(): LiveOCRSnapshot {
		return {
			sessionId: this.sessionId,
			consensus: this.currentBuilder?.getConsensus() || null,
			framesDispatched: this.framesDispatched,
			cyclesRun: this.cyclesRun,
			sessionIdChanges: this.sessionIdChanges,
			msInAlignedState: this.alignedSince ? performance.now() - this.alignedSince : 0,
			pixelStabilityScores: [...this.pixelStabilityScores]
		};
	}

	reset() {
		this.endSession();
		this.sessionId = 0;
		this.sessionIdChanges = 0;
		this.currentBuilder = null;
		this.lastProbe = null;
		this.pixelStabilityScores = [];
		this.cyclesRun = 0;
		this.framesDispatched = 0;
	}
}

export const liveOCRCoordinator = new LiveOCRCoordinator();
