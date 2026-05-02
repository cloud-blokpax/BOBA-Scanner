// ── App User (enriched Supabase user for layout data) ──────
export interface AppUser {
	id: string;
	email?: string;
	user_metadata?: Record<string, unknown>;
	app_metadata?: Record<string, unknown>;
	is_admin: boolean;
	is_pro: boolean;
	pro_until: string | null;
}

// ── Card Types ──────────────────────────────────────────────────

export interface Card {
	id: string;
	name: string;
	hero_name: string | null;
	athlete_name: string | null;
	set_code: string;
	card_number: string | null;
	parallel: string | null;
	power: number | null;
	rarity: CardRarity | null;
	weapon_type: string | null;
	battle_zone: string | null;
	image_url: string | null;
	created_at: string;
	/** Which game this card belongs to ('boba', 'wonders', etc.) */
	game_id?: string;
	/** Game-specific metadata (JSONB). Wonders uses this for cost, type_line,
	 *  card_class, hierarchy, orbitals, lineage, faction, rules_text, etc. */
	metadata?: Record<string, unknown> | null;
	/** Release year: 2025 for Alpha Edition / Alpha Update, 2026 for Griffey Edition */
	year?: number | null;
	/** Base play name for variant deduplication (e.g. "Blitz" for "Blitz Alpha", "Blitz Blast") */
	base_play_name?: string;
	/** Whether this is a bonus play (ultra-rare, beyond the standard 30) */
	is_bonus_play?: boolean;
}

export type CardRarity = 'common' | 'uncommon' | 'rare' | 'ultra_rare' | 'legendary';

export type CardCondition = 'mint' | 'near_mint' | 'excellent' | 'good' | 'fair' | 'poor';

// ── Collection Types ────────────────────────────────────────────

export interface CollectionItem {
	id: string;
	user_id: string;
	card_id: string;
	quantity: number;
	condition: CardCondition;
	notes: string | null;
	added_at: string;
	scan_image_url?: string | null;
	/** Physical parallel for this copy (human-readable name, e.g. "Classic Foil"
	 *  for Wonders or "Battlefoil" for BoBA). Part of the collection identity
	 *  triple (user_id, card_id, parallel). Defaults to 'Paper'. */
	parallel?: string;
	/** Game this collection entry belongs to ('boba', 'wonders'). */
	game_id?: string;
	card?: Card;
}

// ── Scan Types ──────────────────────────────────────────────────

export type ScanMethod =
	| 'hash_cache'
	| 'tesseract'
	| 'claude'
	| 'manual'
	| 'local_ocr'   // Phase 2.1a — canonical PaddleOCR win
	| 'upload_tta'; // Phase 2.1b — upload test-time-augmentation win

export type ValidationMethod = 'exact_match' | 'fuzzy_match' | 'name_only_fallback' | 'unvalidated';

export interface ScanResult {
	id?: string;
	card_id: string | null;
	card: Card | null;
	scan_method: ScanMethod;
	confidence: number;
	processing_ms: number;
	/** Resolved parallel as a human-readable name (e.g. "Classic Foil"). Mirrors
	 *  cards.parallel for the matched card. Ready for DB write. */
	parallel?: string | null;
	/** Confidence in parallel detection (0.0-1.0). null when parallel wasn't detected
	 *  (e.g., Tier 2 OCR matches). Values below 0.75 trigger the foil multi-scan flow. */
	parallel_confidence?: number | null;
	/** True when a 1st edition stamp is visible at the bottom-left of the card,
	 *  distinct from the collector number. Paper cards never have this stamp. */
	first_edition_stamp_detected?: boolean;
	/** Confidence specifically in the collector_number reading (0.0-1.0). Glare
	 *  on foil cards can reduce this independently of overall scan confidence. */
	collector_number_confidence?: number | null;
	/** Which game this scan identified (null if auto-detect failed or scan failed) */
	game_id?: string | null;
	/** Human-readable reason when scan fails to identify a card */
	failReason?: string | null;
	/** Trace ID for correlating logs across tiers */
	traceId?: string;
	/** How the card number was validated against the database (Tier 3 only) */
	validationMethod?: ValidationMethod | null;
	/** Warnings from cross-validation (e.g., fuzzy match, name mismatch) */
	validationWarnings?: string[];
	/** Promise resolving to a listing-quality JPEG blob (only available client-side after scan) */
	_listingImagePromise?: Promise<Blob | null>;
	/** Session 2.1a: live-OCR consensus reached threshold before shutter. */
	liveConsensusReached?: boolean | null;
	/** Session 2.1a: live consensus agreed with canonical OCR result (null when
	 *  canonical itself was uncertain or no live session ran). */
	liveVsCanonicalAgreed?: boolean | null;
	/** Session 2.1a: which fallback tier produced this result (null when the
	 *  local PaddleOCR Tier 1 path was sufficient). */
	fallbackTierUsed?: 'none' | 'haiku' | 'sonnet' | 'manual' | null;
	/** Session 2.1a: decision context (live session snapshot, canonical OCR,
	 *  live-vs-canonical divergence). Merged into scans.decision_context. */
	decisionContext?: Record<string, unknown>;
	/** Session 2.1b: explicit override for the `winning_tier` column. When
	 *  set, recognition.finalize() writes this value instead of deriving one
	 *  from `scan_method`. Used by the upload-TTA fallback so telemetry can
	 *  distinguish 'tier1_local_ocr' (canonical won) from
	 *  'tier1_upload_tta' (canonical failed, TTA rescued). */
	winningTier?: string | null;
	/** Phase 1 Doc 1.0: catalog cross-validation outcome. Forwarded to the
	 *  scans.catalog_validation_passed / .catalog_validation_failure_reason
	 *  columns by recognition.finalize(). NULL when the validation flag is
	 *  off or this scan never reached Tier 1. */
	catalogValidationPassed?: boolean | null;
	catalogValidationFailureReason?: string | null;
	/** Phase 2 Doc 2.0: TRUE when Tier 1 returned via the pre-shutter live
	 *  consensus short-circuit, skipping the canonical OCR pass. FALSE when
	 *  canonical ran. NULL when Tier 1 didn't run. Forwarded to
	 *  scans.tier1_short_circuited by recognition.finalize(). */
	tier1ShortCircuited?: boolean | null;
	/** Phase 2 Doc 2.4: region-OCR batching telemetry. */
	ocrRegionBatchSize?: number | null;
	ocrRegionTotalMs?: number | null;
}

export interface ScanPipelineState {
	status: 'idle' | 'capturing' | 'processing' | 'tier1' | 'tier2' | 'complete' | 'error';
	currentTier: 1 | 2 | 3 | null;
	result: ScanResult | null;
	error: string | null;
}

// ── Claude API Response ─────────────────────────────────────────

export interface ClaudeCardResponse {
	card_name: string;
	hero_name: string;
	athlete_name: string | null;
	set_code: string;
	card_number: string;
	power: number | null;
	rarity: CardRarity;
	parallel: string;
	weapon_type: string | null;
	confidence: number;
}

// ── Price Types ─────────────────────────────────────────────────

export interface PriceData {
	card_id: string;
	source: string;
	price_low: number | null;
	price_mid: number | null;
	price_high: number | null;
	listings_count: number | null;
	fetched_at: string;
	buy_now_low?: number | null;
	buy_now_mid?: number | null;
	buy_now_count?: number | null;
}

// ── Hash Cache ──────────────────────────────────────────────────

export interface HashCacheEntry {
	phash: string;
	card_id: string;
	confidence: number;
	scan_count: number;
	last_seen: string;
}

// ── Grading Types ──────────────────────────────────────────────

export type GradeQualifier = 'OC' | 'MC' | 'MK' | 'ST' | 'PD' | 'OF';

export interface GradeResult {
	grade: number;
	grade_label: string | null;
	qualifier: GradeQualifier | null;
	confidence: number | null;
	front_centering: string | null;
	back_centering: string | null;
	corners: string | null;
	edges: string | null;
	surface: string | null;
	summary: string | null;
	submit_recommendation: 'yes' | 'maybe' | 'no' | null;
}

// ── Image Processing ────────────────────────────────────────────

export interface BlurCheckResult {
	isBlurry: boolean;
	variance: number;
}

export interface OcrResult {
	text: string;
	confidence: number;
	words: Array<{ text: string; confidence: number }>;
}

// ── Scraping Test (admin-only pricing intelligence) ─────
export interface ScrapingTestData {
	st_price: number | null;
	st_low: number | null;
	st_high: number | null;
	st_source_id: string | null;
	st_card_name: string | null;
	st_set_name: string | null;
	st_variant: string | null;
	st_rarity: string | null;
	st_image_url: string | null;
	st_raw_data: Record<string, unknown> | null;
	st_updated: string | null;
}
