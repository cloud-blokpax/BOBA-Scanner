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

/**
 * Per-contour forensic snapshot. Captured for every contour that passed the
 * minimum-area threshold inside a single detection pass (Canny layer or
 * adaptive). Sized so the doc's "approxPolyDP would never converge to 4"
 * class of bug is observable without re-running the detector.
 *
 * `approx_vertex_counts_per_eps` is the field that would have caught the
 * 8-vertex bug on the first scan: a Battlefoil holo whose vertex counts
 * stayed >= 6 at every tried epsilon is now visible in telemetry.
 */
export interface ContourDiagnostic {
	contour_area_downscaled: number;
	bounding_rect: { x: number; y: number; w: number; h: number };
	/** Keyed by the epsilon factor (as string) used in approxPolyDP. */
	approx_vertex_counts_per_eps: Record<string, number>;
	min_area_rect_aspect: number;
	min_area_rect_angle: number;
	min_area_rect_size: [number, number];
	convex_hull_area: number;
	rectangularity: number;
	perimeter: number;
	passed_aspect: boolean;
	/** Informational: no rectangularity gate is active in code today.
	 *  True when rectangularity >= 0.85. */
	passed_rectangularity: boolean;
	/** True for the single contour that was promoted to the final detection. */
	final_picked: boolean;
}

/**
 * Per-detection-pass summary. One entry per Canny threshold pair, plus one
 * for the adaptive fallback when it runs. `edges_after_morph_pct` is the
 * fraction of pixels in the (downsampled) frame that survived the
 * accumulated Canny + morph close — useful for spotting low-edge frames
 * where the detector had nothing to work with.
 */
export interface DetectionPassDiagnostic {
	layer: string;
	edges_after_morph_pct: number;
	contours_total: number;
	contours_passed_area: number;
	contours_passed_border_inset: number;
	contour_diagnostics: ContourDiagnostic[];
}

/**
 * Top-level detection forensics. Attached to CardDetection.extras and
 * carried through recognition.ts → tier1-telemetry → scan_tier_results.
 * Cap: per-pass contour list is sorted by area desc and trimmed to 10
 * entries at the detector site so a noisy frame can't blow the row.
 */
export interface ContourTelemetry {
	passes: DetectionPassDiagnostic[];
	picked_layer: string | null;
	picked_aspect: number | null;
	picked_rectangularity: number | null;
	picked_box_area_pct_of_bitmap: number | null;
	rejection_reasons: {
		below_min_area: number;
		touches_border_inset: number;
		no_quad_at_any_eps: number;
		aspect_out_of_range: number;
	};
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
	/** Per-pass contour forensics from upload-card-detector. NULL when the
	 *  detector ran centered_fallback before any contour pass, or when the
	 *  caller's capture mode didn't run detectCard (e.g. live shutter
	 *  path where the bitmap arrives pre-cropped). */
	contour_diagnostics: ContourTelemetry | null;
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

/**
 * Phase 1 — frame fusion diagnostics. Populated by the Scanner shutter path
 * when it composites the best K buffered frames before detection. NULL for
 * paths that skip fusion (uploads, binder, manual capture).
 */
export interface Tier1FusionDiag {
	frames_buffered: number;
	frames_used: number;
	composite_method: 'median' | 'min_pixel' | 'shutter_only';
	pre_composite_blur_variance: number;
	post_composite_blur_variance: number;
	per_frame_scores: Array<{
		blur_variance: number;
		glare_area_pct: number;
		composite_score: number;
		used: boolean;
	}>;
	composite_ms: number;
}

/**
 * Phase 3 — visual feature signals extracted from the canonical crop
 * (border color, etc). Used by catalog lookup as a parallel hint. NULL when
 * the sampler errored or capture mode skipped it.
 */
export interface Tier1VisualFeatures {
	border_color_lab: [number, number, number];
	nearest_parallel_by_color: string;
	color_distance: number;
	margin_to_2nd: number;
	elapsed_ms: number;
}

/**
 * Phase 3 — catalog lookup diagnostics, including whether the parallel hint
 * was used and whether it changed the winning candidate.
 */
export interface Tier1CatalogDiag {
	parallel_hint_used: boolean;
	parallel_hint_value: string | null;
	parallel_hint_changed_winner: boolean;
}

/**
 * Phase 2 — edge-fit corner refinement diagnostics. Records RANSAC fit
 * quality per side and per-corner displacement from the minAreaRect output.
 */
export interface Tier1EdgeFitDiag {
	contour_points_total: number;
	points_per_side: number[];
	points_rejected_as_outliers: number;
	ransac_inlier_pct: number[];
	corner_displacement_from_minarearect_px: number[];
	fitted_line_residual_rmse_px: number[];
	elapsed_ms: number;
	used: boolean;
}

/**
 * Phase 6 — lens distortion correction. Records which intrinsics were used
 * and whether they were actually applied.
 */
export interface Tier1LensDiag {
	device_label: string;
	intrinsic_source: 'published_apple' | 'published_google' | 'estimated' | 'identity';
	correction_applied: boolean;
	elapsed_ms: number;
}

/**
 * Phase 7 — region template selection diagnostics. Records which per-parallel
 * template fed PaddleOCR.
 */
export interface Tier1TemplateDiag {
	template_used: string;
	parallel_hint_at_selection: string | null;
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
	/** Phase 1 — populated only by the live Scanner path. */
	fusion_diag?: Tier1FusionDiag | null;
	/** Phase 3 — populated when border color sampling ran. */
	visual_features?: Tier1VisualFeatures | null;
	/** Phase 3 — populated when catalog lookup considered a parallel hint. */
	catalog_diag?: Tier1CatalogDiag | null;
	/** Phase 2 — populated when edge-fit refinement was attempted. */
	edge_fit_diag?: Tier1EdgeFitDiag | null;
	/** Phase 6 — populated when lens correction was attempted. */
	lens_correction?: Tier1LensDiag | null;
	/** Phase 7 — populated when a per-parallel template was selected. */
	template_diag?: Tier1TemplateDiag | null;
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
