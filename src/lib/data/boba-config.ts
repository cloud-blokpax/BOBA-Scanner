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
	blurThreshold: 100,
	maxUploadSize: 1024,
	aiCostPerScan: 0.003,
	/** Maximum file size for API upload (bytes) */
	maxFileSize: 10_000_000,
	/** Maximum pixel count (pixel bomb protection) */
	maxPixels: 16_000_000,
	/** Allowed MIME types for card image uploads */
	allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp']
} as const;

/** Maps release letter codes (from play-cards.json) to display set names */
export const RELEASE_TO_SET_NAME: Record<string, string> = {
	A: 'Alpha Edition',
	G: 'Griffey Edition',
	U: 'Alpha Update',
	HTD: 'Alpha Blast'
};
