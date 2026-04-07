/**
 * BOBA card game constants.
 *
 * Single source of truth for OCR regions, scan config, and card metadata.
 * Used by the recognition pipeline and UI components.
 */

export const BOBA_OCR_REGIONS = [
	{ x: 0.01, y: 0.84, w: 0.35, h: 0.13, label: 'bottom-left' },
	{ x: 0.60, y: 0.84, w: 0.35, h: 0.13, label: 'bottom-right' },
	{ x: 0.0, y: 0.80, w: 1.0, h: 0.18, label: 'full-strip' }
] as const;

export const BOBA_SCAN_CONFIG = {
	quality: 0.85,
	ocrConfidenceThreshold: 30,
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
	/** Tesseract worker restart interval (recognitions before restart) */
	ocrWorkerRestartInterval: 50,
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
