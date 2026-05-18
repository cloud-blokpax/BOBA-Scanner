/**
 * Tier 1 telemetry assembly — pure function that builds the persisted
 * `scan_tier_results` row from state collected during `runTier1`.
 *
 * Lives outside `consensus-builder.ts` because consensus-builder is a vote
 * tallier with no view of detection, catalog lookup, or path-decision data.
 * `runTier1` in `recognition-tiers.ts` is the actual convergence point for
 * the four capture modes (live camera / canonical / upload TTA / binder grid)
 * and owns the data this assembler reads.
 *
 * Diagnostic plumbing only — no algorithm decisions read these fields. Off
 * the hot path: assembly is synchronous (data is in scope) but the writer
 * call is fire-and-forget and never throws to the user.
 */

import { PIPELINE_VERSION } from './pipeline-version';
import type { CanonicalResult } from './tier1-canonical';
import type { LiveOCRSnapshot } from './live-ocr-coordinator';
import type {
	Tier1Candidate,
	Tier1CatalogLookup,
	Tier1Detection,
	Tier1MissCategory,
	Tier1PathTaken,
	Tier1TelemetryPayload,
	OcrRegion
} from './tier1-telemetry.types';

const OCR_TEXT_RAW_CAP = 2000;
const NOTES_CAP = 500;
const ERROR_MESSAGE_CAP = 500;
const TOPN_CAP = 10;
const REGIONS_CAP = 10;

// Empirical aspect-ratio windows for a properly-cropped 750×1050 BoBA/Wonders
// canonical (~1.4). Outside this range the detector likely cropped the wrong
// region (frame artifact, inner artwork, sleeve). 1.30–1.35 is a known
// "BoBA holo artwork frame" footprint — flagged separately by miss-category.
const ASPECT_RATIO_MIN = 1.35;
const ASPECT_RATIO_MAX = 1.50;
const ASPECT_RATIO_HOLO_FRAME_MIN = 1.30;
const ASPECT_RATIO_HOLO_FRAME_MAX = 1.35;

function clampStr(s: string | null | undefined, max: number): string | null {
	if (s == null) return null;
	return s.length > max ? s.slice(0, max) : s;
}

function readNum(obj: Record<string, unknown> | null | undefined, key: string): number | null {
	if (!obj) return null;
	const v = obj[key];
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readStr(obj: Record<string, unknown> | null | undefined, key: string): string | null {
	if (!obj) return null;
	const v = obj[key];
	return typeof v === 'string' && v.length > 0 ? v : null;
}

function readBool(obj: Record<string, unknown> | null | undefined, key: string): boolean | null {
	if (!obj) return null;
	const v = obj[key];
	return typeof v === 'boolean' ? v : null;
}

export interface BuildTier1TelemetryArgs {
	captureSource: string;
	engineVersion: string;
	latencyMs: number;
	errored: boolean;
	errorMessage: string | null;
	errorCode: string | null;
	skipReason: string | null;
	pathTaken: Tier1PathTaken;
	gameHint: string;
	confidenceFloor: number;
	canonical: CanonicalResult | null;
	liveSnapshot: LiveOCRSnapshot | null;
	cardDetectContext: Record<string, unknown> | null;
	/** Final winning card (from canonical, TTA, or short-circuit). Null on miss. */
	winningCardId: string | null;
	winningParallel: string | null;
	winningConfidence: number | null;
	winningCardNumber: string | null;
	winningCardName: string | null;
	/** Whether this scan would have hit (any tier 1 path produced a card). */
	hit: boolean;
	/** Free-text notes from the path decision; capped at NOTES_CAP. */
	notes: string | null;
}

/**
 * Decide the miss_category for a Tier 1 row. Rules applied in document order;
 * first match wins. Returns null when outcome=hit.
 */
export function classifyTier1Miss(args: {
	hit: boolean;
	errored: boolean;
	skipReason: string | null;
	canonical: CanonicalResult | null;
	detection: Tier1Detection;
	liveConsensusReached: boolean;
	liveFramesWithText: number;
	cardNumberPrefixValid: boolean | null;
	ocrMeanConfidence: number | null;
	candidatesReturned: number;
	catalogRejectReason: Tier1CatalogLookup['reject_reason'];
}): Tier1MissCategory | null {
	if (args.hit) return null;
	if (args.skipReason === 'feature_flag_off') return 'feature_flag_off';
	if (args.errored) return 'engine_error';
	if (
		args.detection.method === 'centered_fallback' &&
		args.liveFramesWithText === 0 &&
		!args.canonical?.cardNumber
	) {
		return 'detector_no_card';
	}
	if (args.detection.aspect_ratio_valid === false) {
		// Special-case the BoBA holo artwork-frame footprint before the generic
		// aspect-ratio reject, so the analyst can split "detector cropped a
		// nested rectangle" from "detector cropped something pathological".
		const ar = args.detection.aspect_ratio;
		if (
			ar !== null &&
			ar >= ASPECT_RATIO_HOLO_FRAME_MIN &&
			ar <= ASPECT_RATIO_HOLO_FRAME_MAX
		) {
			return 'detector_wrong_region_suspected';
		}
		return 'aspect_ratio_invalid';
	}
	if (
		(args.canonical?.perTask.name.raw || args.canonical?.cardNumber) &&
		args.cardNumberPrefixValid === false
	) {
		return 'ocr_no_card_number_pattern';
	}
	if (args.ocrMeanConfidence !== null && args.ocrMeanConfidence < 0.55) {
		return 'ocr_low_confidence';
	}
	if (!args.liveConsensusReached && args.canonical && !args.canonical.cardNumber) {
		return 'consensus_no_quorum';
	}
	if (args.candidatesReturned === 0) return 'catalog_no_match';
	if (args.catalogRejectReason === 'parallel_ambiguous') return 'parallel_ambiguous';
	if (args.candidatesReturned > 1 && !args.canonical?.parallel) {
		return 'parallel_ambiguous';
	}
	return 'consensus_no_quorum';
}

function pickCardNumberPrefix(cn: string | null): { prefix: string | null; valid: boolean | null } {
	if (!cn) return { prefix: null, valid: null };
	const m = cn.match(/^([A-Z]+)-/i);
	if (!m) {
		// Pure-digit card numbers exist (legacy/play cards) — treat as valid
		// pattern when shape matches the digit form.
		if (/^[0-9]{1,4}(\/[0-9]{1,4})?$/.test(cn)) {
			return { prefix: null, valid: true };
		}
		return { prefix: null, valid: false };
	}
	return { prefix: m[1].toUpperCase(), valid: true };
}

function deriveAspectRatioValid(ar: number | null): boolean | null {
	if (ar === null) return null;
	if (ar >= ASPECT_RATIO_MIN && ar <= ASPECT_RATIO_MAX) return true;
	return false;
}

function buildDetection(ctx: Record<string, unknown> | null): Tier1Detection {
	const method = readStr(ctx, 'method') ?? 'unknown';
	const layer = readStr(ctx, 'detection_layer');
	const aspectRatio = readNum(ctx, 'aspect_ratio');
	const cardAreaPct = readNum(ctx, 'card_area_pct');
	const rectificationApplied = readBool(ctx, 'rectification_applied') ?? false;
	const corners = (ctx?.corners as number[][] | undefined) ?? null;
	const rejected = (ctx?.rejected_layers_tried as string[] | undefined) ?? [];
	return {
		method,
		layer,
		aspect_ratio: aspectRatio,
		aspect_ratio_valid: deriveAspectRatioValid(aspectRatio),
		card_area_pct: cardAreaPct,
		rectification_applied: rectificationApplied,
		corners_clockwise_from_topleft: corners,
		rejected_layers_tried: rejected
	};
}

function buildOcrRegions(canonical: CanonicalResult | null): OcrRegion[] {
	if (!canonical) return [];
	const regions: OcrRegion[] = [];
	if (canonical.perTask.cardNumber.raw) {
		regions.push({
			region: 'card_number',
			text: canonical.perTask.cardNumber.raw,
			confidence: canonical.perTask.cardNumber.confidence
		});
	}
	if (canonical.perTask.name.raw) {
		regions.push({
			region: 'name',
			text: canonical.perTask.name.raw,
			confidence: canonical.perTask.name.confidence
		});
	}
	if (canonical.perTask.setCode?.raw) {
		regions.push({
			region: 'set_code',
			text: canonical.perTask.setCode.raw,
			confidence: canonical.perTask.setCode.confidence
		});
	}
	return regions.slice(0, REGIONS_CAP);
}

function buildOcrFullText(canonical: CanonicalResult | null): string | null {
	if (!canonical) return null;
	const parts: string[] = [];
	if (canonical.perTask.cardNumber.raw) parts.push(canonical.perTask.cardNumber.raw);
	if (canonical.perTask.name.raw) parts.push(canonical.perTask.name.raw);
	if (canonical.perTask.setCode?.raw) parts.push(canonical.perTask.setCode.raw);
	const joined = parts.join(' ').trim();
	return joined.length > 0 ? joined : null;
}

function deriveMeanConfidence(canonical: CanonicalResult | null): number | null {
	if (!canonical) return null;
	const samples: number[] = [];
	if (canonical.perTask.cardNumber.confidence > 0) samples.push(canonical.perTask.cardNumber.confidence);
	if (canonical.perTask.name.confidence > 0) samples.push(canonical.perTask.name.confidence);
	if (canonical.perTask.setCode && canonical.perTask.setCode.confidence > 0) {
		samples.push(canonical.perTask.setCode.confidence);
	}
	if (samples.length === 0) return null;
	return samples.reduce((a, b) => a + b, 0) / samples.length;
}

export function buildTier1TelemetryPayload(args: BuildTier1TelemetryArgs): Tier1TelemetryPayload {
	const { canonical, liveSnapshot } = args;

	const ocrFullText = buildOcrFullText(canonical);
	const ocrRegions = buildOcrRegions(canonical);
	const meanConf = deriveMeanConfidence(canonical);
	const wordCount = ocrFullText ? ocrFullText.split(/\s+/).filter(Boolean).length : null;

	const detection = buildDetection(args.cardDetectContext);

	const live = liveSnapshot?.consensus ?? null;
	const liveWinnerText = live?.cardNumber?.value ?? null;
	const canonicalText = canonical?.cardNumber ?? null;
	const liveAgreed =
		live && canonical
			? !!(
					live.reachedThreshold &&
					live.cardNumber?.value === canonical.cardNumber &&
					live.name?.value === canonical.name
				)
			: null;
	const agreementField: 'card_number' | 'name' | 'both' | 'none' | null = liveAgreed === null
		? null
		: liveAgreed
			? 'both'
			: 'none';

	const { prefix, valid: prefixValid } = pickCardNumberPrefix(canonicalText);

	const candidatesReturned = args.winningCardId ? 1 : 0;
	const catalog: Tier1CatalogLookup = {
		attempted: !!(canonical && canonical.cardNumber),
		card_number_lookup_count: canonical && canonical.cardNumber ? 1 : 0,
		name_lookup_count: canonical && canonical.name ? 1 : 0,
		candidates_returned: candidatesReturned,
		winning_card_id: args.winningCardId,
		winning_parallel: args.winningParallel,
		reject_reason:
			args.hit || !(canonical && canonical.cardNumber)
				? null
				: candidatesReturned === 0
					? 'no_match'
					: null
	};

	const topnCandidates: Tier1Candidate[] = args.winningCardId
		? [
				{
					card_id: args.winningCardId,
					name: args.winningCardName ?? '',
					card_number: args.winningCardNumber ?? '',
					parallel: args.winningParallel ?? '',
					score: args.winningConfidence ?? 0,
					why_chosen:
						args.pathTaken === 'short_circuit'
							? 'live_short_circuit'
							: args.pathTaken === 'canonical_tta'
								? 'tta_consensus'
								: 'card_number_exact_match'
				}
			]
		: [];

	const missCategory = classifyTier1Miss({
		hit: args.hit,
		errored: args.errored,
		skipReason: args.skipReason,
		canonical,
		detection,
		liveConsensusReached: !!live?.reachedThreshold,
		liveFramesWithText: liveSnapshot?.framesDispatched ?? 0,
		cardNumberPrefixValid: prefixValid,
		ocrMeanConfidence: meanConf,
		candidatesReturned,
		catalogRejectReason: catalog.reject_reason
	});

	const outcome: Tier1TelemetryPayload['outcome'] = args.errored
		? 'error'
		: args.skipReason
			? 'skipped'
			: args.hit
				? 'hit'
				: 'miss';

	const rawOutput: Record<string, unknown> = canonical
		? {
				per_task: canonical.perTask,
				ocr_strategy: canonical.ocrStrategy,
				validation: canonical.validation,
				ocr_region_batch_size: canonical.ocrRegionBatchSize,
				ocr_region_total_ms: canonical.ocrRegionTotalMs
			}
		: {};

	return {
		engine: 'paddleocr_pp_v5',
		engine_version: args.engineVersion,
		latency_ms: args.latencyMs,
		cost_usd: 0,
		errored: args.errored,
		error_message: clampStr(args.errorMessage, ERROR_MESSAGE_CAP),
		error_code: args.errorCode,
		outcome,
		skip_reason: args.skipReason,
		parsed_card_id: args.winningCardId,
		parsed_parallel: args.winningParallel,
		parsed_confidence: args.winningConfidence,
		ocr_text_raw: clampStr(ocrFullText, OCR_TEXT_RAW_CAP),
		ocr_mean_confidence: meanConf,
		ocr_word_count: wordCount,
		ocr_detected_card_number: canonicalText,
		ocr_orientation_deg: null,
		topn_candidates: topnCandidates.slice(0, TOPN_CAP),
		raw_output: rawOutput,
		extras: {
			frames: {
				live_frames_seen: liveSnapshot?.framesDispatched ?? 0,
				live_frames_with_text: liveSnapshot?.framesDispatched ?? 0,
				live_frames_with_card_number_pattern: live?.cardNumber?.votesSeen ?? 0,
				live_consensus_reached: !!live?.reachedThreshold,
				live_consensus_top_text: liveWinnerText,
				live_consensus_agreement_count: live?.cardNumber?.agreementCount ?? 0,
				live_consensus_threshold: 2,
				live_winner_text: liveWinnerText,
				live_total_ms: Math.round(liveSnapshot?.msInAlignedState ?? 0)
			},
			canonical: {
				ran: !!canonical,
				ocr_full_text: clampStr(ocrFullText, OCR_TEXT_RAW_CAP),
				ocr_regions: ocrRegions,
				ocr_engine_init_ms: null,
				ocr_inference_ms: canonical?.ocrRegionTotalMs ?? null,
				ocr_total_ms: canonical?.ocrRegionTotalMs ?? null,
				preprocessing_applied: canonical
					? [canonical.ocrStrategy === 'region' ? 'region_crop' : 'full_frame']
					: []
			},
			detection,
			consensus: {
				live_vs_canonical_agreed: liveAgreed,
				live_text: liveWinnerText,
				canonical_text: canonicalText,
				agreement_field: agreementField,
				card_number_prefix_valid: prefixValid,
				card_number_prefix: prefix,
				fuzzy_match_attempted: false,
				fuzzy_match_top_distance: null,
				fuzzy_match_top_card_id: null
			},
			catalog_lookup: catalog,
			decision: {
				would_have_hit: args.hit,
				would_have_hit_with_relaxed_threshold: null,
				miss_category: missCategory,
				notes: clampStr(args.notes, NOTES_CAP),
				path_taken: args.pathTaken
			},
			capture_source: args.captureSource,
			pipeline_version: PIPELINE_VERSION
		}
	};
}
