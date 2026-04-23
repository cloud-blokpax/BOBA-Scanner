/**
 * BOBA card game constants.
 *
 * Single source of truth for OCR regions, scan config, and card metadata.
 * Used by the recognition pipeline and UI components.
 */

export const BOBA_SCAN_CONFIG = {
	quality: 0.85,
	blurThreshold: 25, // Lowered from 35 — mobile cameras with slight motion were failing auto-detect
	maxUploadSize: 1024,
	aiCostPerScan: 0.003,
	/** Maximum file size for API upload (bytes) */
	maxFileSize: 10_000_000,
	/** Maximum pixel count (pixel bomb protection) */
	maxPixels: 16_000_000,
	/** Allowed MIME types for card image uploads */
	allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp']
} as const;

// ── Recognition Pipeline Thresholds ─────────────────────────
export const BOBA_PIPELINE_CONFIG = {
	/** Minimum blur variance for reference image submission */
	referenceImageMinVariance: 150,
	/** Max OCR corrections stored in local learning cache */
	maxOcrCorrections: 500,
	/** Reference image resize max dimension */
	referenceImageMaxDimension: 800,
	/** Minimum confidence to submit a reference image */
	referenceImageMinConfidence: 0.8,
	/** dHash fuzzy match max Hamming distance */
	hashFuzzyMaxDistance: 5,
	/** pHash verification max Hamming distance (256-bit hash) */
	pHashVerifyMaxDistance: 20,
	/** Confidence penalty per bit of dHash distance */
	hashDistanceConfidencePenalty: 0.015,
} as const;

// ── Rate Limit Config ───────────────────────────────────────
export const BOBA_RATE_LIMITS = {
	/** Global rate limit map cleanup threshold */
	globalRateLimitMapMaxSize: 5000,
	/** In-memory rate limit map cleanup threshold */
	inMemoryRateLimitMapMaxSize: 1000,
	/** Max scan history entries */
	maxScanHistoryEntries: 100,
} as const;

/**
 * Maps set codes to display set names.
 * Includes BOTH the short UI codes (A, G, U) used by the pack simulator
 * AND the actual DB set_code values (AE, GE, AU) stored on cards.
 * buildSetMatchers() uses this to cross-reference all forms.
 */
/**
 * Set codes that qualify for each card pool restriction.
 * Used by the deck validator to enforce format-specific card legality.
 *
 * 'all_in_rotation' and 'modern' are not listed — they allow everything.
 * Weapon/parallel-based pools (brawl_weapons_only, etc.) are handled
 * by the allowedWeapons and allowedParallels format properties.
 */
export const CARD_POOL_SETS: Record<string, Set<string>> = {
	alpha_trilogy: new Set([
		'Alpha Edition', 'Griffey Edition', 'Alpha Update', 'Alpha Blast',
		'Black Label Collection', 'National 2024', 'World Champions', 'Sandstorm Superfan Series',
		'AE', 'GE', 'AU', 'AB', 'BLC', 'N24', 'WC', 'SS',
		'A', 'G', 'U', 'HTD'
	]),
	tecmo_only: new Set(['Tecmo Bowl', 'T']),
	blast_only: new Set(['Alpha Blast', 'AB', 'HTD']),
};

export const RELEASE_TO_SET_NAME: Record<string, string> = {
	A: 'Alpha Edition',
	AE: 'Alpha Edition',
	G: 'Griffey Edition',
	GE: 'Griffey Edition',
	U: 'Alpha Update',
	AU: 'Alpha Update',
	AB: 'Alpha Blast',
	HTD: 'Alpha Blast',
	BLC: 'Black Label Collection',
	N24: 'National 2024',
	WC: 'World Champions',
	SS: 'Sandstorm Superfan Series',
	T: 'Tecmo Bowl',
};
