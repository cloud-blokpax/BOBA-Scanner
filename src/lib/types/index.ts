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
	card?: Card;
}

// ── Scan Types ──────────────────────────────────────────────────

export type ScanMethod = 'hash_cache' | 'tesseract' | 'claude' | 'manual';

export type ValidationMethod = 'exact_match' | 'fuzzy_match' | 'name_only_fallback' | 'unvalidated';

export interface ScanResult {
	id?: string;
	card_id: string | null;
	card: Card | null;
	scan_method: ScanMethod;
	confidence: number;
	processing_ms: number;
	variant?: string | null;
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
}

export interface ScanPipelineState {
	status: 'idle' | 'capturing' | 'processing' | 'tier1' | 'tier2' | 'tier3' | 'complete' | 'error';
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
	variant: string;
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
