/**
 * Upload pipeline — Test-time augmentation (TTA) voting over PaddleOCR.
 *
 * Session 2.1b. This is a Tier 1 FALLBACK path, not the primary upload
 * route. Call sequence at the recognition layer is:
 *
 *   runCanonicalTier1 (2.1a)   → wins most clean uploads at ≥0.60 conf
 *     └─ runUploadPipeline     ← this file; only when canonical falls short
 *        └─ Haiku (Tier 3)     ← safety net if TTA can't converge either
 *
 * TTA synthesizes 5 correlated frames from the source image and runs
 * region-OCR on each, feeding votes into the same ConsensusBuilder the
 * live-scan path uses — just with tighter thresholds (3-of-5 agreement,
 * summed confidence ≥ 2.25) because synthetic frames are less independent
 * than real temporal frames.
 *
 * Parallel handling mirrors the canonical path: classifier emits short
 * codes (`paper`|`cf`|`ff`|`ocm`|`sf`) for telemetry; the returned
 * `parallel` field is always the human-readable DB name resolved through
 * `WONDERS_PARALLEL_NAMES`. Short codes must never leave this module.
 */

import { initPaddleOCR, ocrRegion, pickTopBox } from './paddle-ocr';
import { REGIONS, regionToPixels } from './ocr-regions';
import {
	classifyWondersParallel,
	WONDERS_PARALLEL_NAMES,
	type WondersParallel
} from './parallel-classifier';
import { ConsensusBuilder } from './consensus-builder';
import { streamFrames, UPLOAD_AUGMENTATIONS } from './upload-frame-generator';
import {
	lookupCard,
	lookupCardByCardNumberFuzzy,
	type MirrorCard
} from './catalog-mirror';

/** Bumped when UPLOAD_AUGMENTATIONS changes so cohorts don't mix in telemetry. */
export const AUGMENTATION_SET_VERSION = 'tta_v1';

// Upload-source voting thresholds. Live-scan defaults (2-of-N, 1.5 summed
// confidence) are too permissive here because TTA frames are correlated —
// an OCR artifact in the source will replicate into most augmented copies.
// 3-of-5 with ≥ 2.25 summed confidence means we need three frames reading
// the same value at an average ≥ 0.75 confidence each.
const UPLOAD_MIN_AGREEMENT = 3;
const UPLOAD_MIN_SUMMED_CONFIDENCE = 2.25;

export interface UploadPerFrameResult {
	cardNumber: { text: string; confidence: number };
	name: { text: string; confidence: number };
	parallel?: { code: WondersParallel; confidence: number; ruleFired: string };
}

export interface UploadPipelineResult {
	card: MirrorCard | null;
	cardNumber: string | null;
	name: string | null;
	/** Always a human-readable name (e.g. "Classic Foil") or null. Safe to
	 *  persist to cards.parallel / collections.parallel. */
	parallel: string | null;
	confidence: number;
	framesProcessed: number;
	consensusReached: boolean;
	/** Internal short code (telemetry only — never persist directly). */
	parallelCode: WondersParallel | null;
	parallelRuleFired: string | null;
	perFrameResults: UploadPerFrameResult[];
	augmentationSetVersion: string;
}

export async function runUploadPipeline(
	sourceBitmap: ImageBitmap,
	game: 'boba' | 'wonders'
): Promise<UploadPipelineResult> {
	await initPaddleOCR();

	const builder = new ConsensusBuilder(1, game, {
		minAgreement: UPLOAD_MIN_AGREEMENT,
		minSummedConfidence: UPLOAD_MIN_SUMMED_CONFIDENCE
	});

	const perFrameResults: UploadPerFrameResult[] = [];
	let lastParallelCode: WondersParallel | null = null;
	let lastParallelRuleFired: string | null = null;
	let framesProcessed = 0;

	// Stream frames one at a time, with the next augmentation pre-computed in
	// parallel with the current frame's OCR. Bounds peak memory to ~32MB
	// (current + next frame) instead of ~80MB (all 5) — stops iOS WebKit OOM
	// on uploads. Augmentation work overlaps with OCR, and we early-exit once
	// consensus is reached (subsequent frames can't improve a passed threshold).
	for await (const { frame } of streamFrames(sourceBitmap)) {
		try {
			const regions = game === 'boba' ? REGIONS.boba : REGIONS.wonders;
			const cardNumberReg = regionToPixels(regions.card_number, frame.width, frame.height);
			const nameReg = regionToPixels(
				game === 'boba' ? REGIONS.boba.hero_name : REGIONS.wonders.card_name,
				frame.width,
				frame.height
			);

			const [numRes, nameRes, parallelRes] = await Promise.allSettled([
				ocrRegion(frame, cardNumberReg, { minWidth: 800 }),
				ocrRegion(frame, nameReg, { minWidth: 1000 }),
				game === 'wonders' ? classifyWondersParallel(frame) : Promise.resolve(null)
			]);

			const frameRecord: UploadPerFrameResult = {
				cardNumber: { text: '', confidence: 0 },
				name: { text: '', confidence: 0 }
			};

			if (numRes.status === 'fulfilled') {
				const top = pickTopBox(numRes.value.boxes);
				if (top?.text) {
					builder.addVote({
						task: 'card_number',
						rawValue: top.text,
						confidence: top.score || numRes.value.confidence,
						sessionId: 1
					});
					frameRecord.cardNumber = {
						text: top.text,
						confidence: top.score || numRes.value.confidence
					};
				}
			}
			if (nameRes.status === 'fulfilled') {
				const top = pickTopBox(nameRes.value.boxes);
				if (top?.text) {
					builder.addVote({
						task: 'name',
						rawValue: top.text,
						confidence: top.score || nameRes.value.confidence,
						sessionId: 1
					});
					frameRecord.name = {
						text: top.text,
						confidence: top.score || nameRes.value.confidence
					};
				}
			}
			if (parallelRes.status === 'fulfilled' && parallelRes.value) {
				builder.addVote({
					task: 'parallel',
					rawValue: parallelRes.value.parallel,
					confidence: parallelRes.value.confidence,
					sessionId: 1
				});
				frameRecord.parallel = {
					code: parallelRes.value.parallel,
					confidence: parallelRes.value.confidence,
					ruleFired: parallelRes.value.ruleFired
				};
				lastParallelCode = parallelRes.value.parallel;
				lastParallelRuleFired = parallelRes.value.ruleFired;
			}

			builder.tickFrame();
			perFrameResults.push(frameRecord);
			framesProcessed++;
		} finally {
			frame.close();
		}

		if (builder.getConsensus().reachedThreshold) {
			break;
		}
	}

	const consensus = builder.getConsensus();
	const cardNumber = consensus.cardNumber?.value || null;
	const name = consensus.name?.value || null;

	// Prefer the consensus-voted parallel for human-name resolution; fall
	// back to the last observed classifier output for pure telemetry purposes.
	const votedParallelCode =
		(consensus.parallel?.value as WondersParallel | undefined) || lastParallelCode;

	let card: MirrorCard | null = null;
	if (cardNumber && name) {
		try {
			card = await lookupCard(game, cardNumber, name);
		} catch {
			// fall through to fuzzy
		}
	}
	if (!card && cardNumber) {
		// Fuzzy fallback handles OCR artifacts inherited from 2.1a —
		// "CastOut"→"Cast Out" space drops, "A-9o"→"A-90" digit confusion.
		const rawName =
			name ||
			perFrameResults
				.map((f) => f.name.text)
				.filter(Boolean)
				.join(' ');
		try {
			card = await lookupCardByCardNumberFuzzy(game, cardNumber, rawName);
		} catch {
			// fall through — consensusReached will reflect the miss
		}
	}

	let parallelHumanName: string | null = null;
	if (game === 'wonders') {
		// Short code → human-readable DB name. WONDERS_PARALLEL_NAMES also
		// handles 'unknown' → 'Paper' so we never persist a short code.
		parallelHumanName = votedParallelCode
			? WONDERS_PARALLEL_NAMES[votedParallelCode]
			: WONDERS_PARALLEL_NAMES.paper;
	} else if (card) {
		// BoBA: cards.parallel is source of truth (prefix-derived on ingest).
		parallelHumanName = card.parallel;
	}

	// Average confidence across the agreeing votes for each task, then take
	// the min across tasks. Matches the 0–1 unit convention used by
	// canonical Tier 1 and downstream telemetry (final_confidence, trackScanMetric).
	// Without this normalization, summedConfidence for a 3-of-5 consensus
	// reads ~2.25–5.0 and skews every TTA-hit dashboard.
	const cnAvg = consensus.cardNumber
		? consensus.cardNumber.summedConfidence / Math.max(1, consensus.cardNumber.agreementCount)
		: 0;
	const nameAvg = consensus.name
		? consensus.name.summedConfidence / Math.max(1, consensus.name.agreementCount)
		: 0;

	return {
		card,
		cardNumber,
		name,
		parallel: parallelHumanName,
		confidence: Math.min(cnAvg, nameAvg),
		framesProcessed,
		consensusReached: consensus.reachedThreshold && !!card,
		parallelCode: votedParallelCode ?? null,
		parallelRuleFired: lastParallelRuleFired,
		perFrameResults,
		augmentationSetVersion: AUGMENTATION_SET_VERSION
	};
}

// Re-exported for callers that want to log the augmentation count alongside
// frames_processed without importing the augmentations array directly.
export const UPLOAD_FRAME_COUNT = UPLOAD_AUGMENTATIONS.length;
