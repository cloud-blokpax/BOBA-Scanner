/**
 * Tier 1 PaddleOCR telemetry payload — forensic row shape for the
 * `scan_tier_results.tier = 'tier1_paddle_ocr'` writes that consensus-builder
 * outputs converge into (via runTier1 in recognition-tiers.ts).
 *
 * Diagnostic plumbing only. No algorithm decisions read these fields.
 *
 * Assembly happens off the hot path in tier1-telemetry.ts and is persisted
 * fire-and-forget by writeTier1Result in scan-writer.ts. Size caps and
 * truncation rules live in the assembly site, not here.
 */

export type Tier1MissCategory =
	| 'consensus_no_quorum'
	| 'ocr_low_confidence'
	| 'ocr_no_card_number_pattern'
	| 'catalog_no_match'
	| 'parallel_ambiguous'
	| 'detector_no_card'
	| 'detector_wrong_region_suspected'
	| 'aspect_ratio_invalid'
	| 'feature_flag_off'
	| 'engine_error'
	| 'timeout';

export type Tier1PathTaken =
	| 'short_circuit'
	| 'canonical'
	| 'canonical_tta'
	| 'skipped';

export interface OcrRegion {
	region: 'card_number' | 'name' | 'set_code' | 'power' | 'flavor' | 'other';
	text: string;
	confidence: number;
	bbox?: [number, number, number, number];
}

export interface Tier1FrameSummary {
	live_frames_seen: number;
	live_frames_with_text: number;
	live_frames_with_card_number_pattern: number;
	live_consensus_reached: boolean;
	live_consensus_top_text: string | null;
	live_consensus_agreement_count: number;
	live_consensus_threshold: number;
	live_winner_text: string | null;
	live_total_ms: number;
}

export interface Tier1CanonicalSummary {
	ran: boolean;
	ocr_full_text: string | null;
	ocr_regions: OcrRegion[];
	ocr_engine_init_ms: number | null;
	ocr_inference_ms: number | null;
	ocr_total_ms: number | null;
	preprocessing_applied: string[];
}

export interface RingValidation {
	looksLikeInnerFrame: boolean;
	meanInsideLum: number;
	meanRingLum: number;
	lumDelta: number;
	meanInsideSat: number;
	meanRingSat: number;
	satDelta: number;
}

export interface Tier1Detection {
	method: string;
	layer: string | null;
	aspect_ratio: number | null;
	aspect_ratio_valid: boolean | null;
	card_area_pct: number | null;
	rectification_applied: boolean;
	corners_clockwise_from_topleft: number[][] | null;
	rejected_layers_tried: string[];
	ring_validation: RingValidation | null;
	ring_rejected: boolean;
}

export interface Tier1Consensus {
	live_vs_canonical_agreed: boolean | null;
	live_text: string | null;
	canonical_text: string | null;
	agreement_field: 'card_number' | 'name' | 'both' | 'none' | null;
	card_number_prefix_valid: boolean | null;
	card_number_prefix: string | null;
	fuzzy_match_attempted: boolean;
	fuzzy_match_top_distance: number | null;
	fuzzy_match_top_card_id: string | null;
}

export interface Tier1CatalogLookup {
	attempted: boolean;
	card_number_lookup_count: number;
	name_lookup_count: number;
	candidates_returned: number;
	winning_card_id: string | null;
	winning_parallel: string | null;
	reject_reason:
		| 'parallel_ambiguous'
		| 'name_mismatch'
		| 'no_match'
		| 'multiple_matches_no_disambiguator'
		| null;
}

export interface Tier1Decision {
	would_have_hit: boolean;
	would_have_hit_with_relaxed_threshold: boolean | null;
	miss_category: Tier1MissCategory | null;
	notes: string | null;
	path_taken: Tier1PathTaken;
}

export interface Tier1Candidate {
	card_id: string;
	name: string;
	card_number: string;
	parallel: string;
	score: number;
	why_chosen: string;
}

export interface Tier1TelemetryExtras {
	frames: Tier1FrameSummary;
	canonical: Tier1CanonicalSummary;
	detection: Tier1Detection;
	consensus: Tier1Consensus;
	catalog_lookup: Tier1CatalogLookup;
	decision: Tier1Decision;
	capture_source: string;
	pipeline_version: string;
}

export interface Tier1TelemetryPayload {
	engine: 'paddleocr_pp_v5';
	engine_version: string;
	latency_ms: number;
	cost_usd: 0;
	errored: boolean;
	error_message: string | null;
	error_code: string | null;
	outcome: 'hit' | 'miss' | 'skipped' | 'error';
	skip_reason: string | null;
	parsed_card_id: string | null;
	parsed_parallel: string | null;
	parsed_confidence: number | null;
	ocr_text_raw: string | null;
	ocr_mean_confidence: number | null;
	ocr_word_count: number | null;
	ocr_detected_card_number: string | null;
	ocr_orientation_deg: number | null;
	topn_candidates: Tier1Candidate[];
	raw_output: unknown;
	extras: Tier1TelemetryExtras;
}
