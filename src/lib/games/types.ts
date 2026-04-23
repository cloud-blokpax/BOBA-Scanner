/**
 * GameConfig — the contract every game module must implement.
 *
 * All game-specific behavior lives behind this interface so the scanner,
 * recognition pipeline, UI, and API routes stay game-agnostic. New games
 * (Wonders, future Game 3) implement this interface and register in the resolver.
 */

// ── Scan Config ────────────────────────────────────────────────

/** Image quality and safety limits for the scan pipeline. */
export interface ScanConfig {
	/** JPEG quality for capture (0.0–1.0) */
	quality: number;
	/** Laplacian variance threshold for blur detection */
	blurThreshold: number;
	/** Max image dimension sent to Claude (px) */
	maxUploadSize: number;
	/** Estimated dollar cost per Claude API scan */
	aiCostPerScan: number;
	/** Maximum file size for API upload (bytes) */
	maxFileSize: number;
	/** Maximum pixel count (pixel bomb protection) */
	maxPixels: number;
	/** Allowed MIME types for card image uploads */
	allowedImageTypes: readonly string[];
}

// ── Pipeline Config ────────────────────────────────────────────

/** Thresholds for the recognition pipeline (hash, OCR, reference images). */
export interface PipelineConfig {
	/** Minimum blur variance for reference image submission */
	referenceImageMinVariance: number;
	/** Max OCR corrections stored in local learning cache */
	maxOcrCorrections: number;
	/** Reference image resize max dimension (px) */
	referenceImageMaxDimension: number;
	/** Minimum confidence to submit a reference image */
	referenceImageMinConfidence: number;
	/** dHash fuzzy match max Hamming distance */
	hashFuzzyMaxDistance: number;
	/** pHash verification max Hamming distance (256-bit hash) */
	pHashVerifyMaxDistance: number;
	/** Confidence penalty per bit of dHash distance */
	hashDistanceConfidencePenalty: number;
}

// ── Theme ──────────────────────────────────────────────────────

/** Visual theme for a game — used to apply game-specific styling. */
export interface GameTheme {
	/** Primary accent color (hex) */
	accentPrimary: string;
	/** Secondary accent color (hex) */
	accentSecondary: string;
	/** Card background color (hex) */
	cardBg: string;
	/** Accent text color (hex) */
	textAccent: string;
}

// ── Navigation ─────────────────────────────────────────────────

export interface GameNavItem {
	id: string;
	path: string;
	icon: string;
	label: string;
	/** Additional paths that activate this nav item */
	matchPaths?: string[];
}

// ── GameConfig ──────────────────────────────────────────────────

export interface GameConfig {
	// ── Identity ────────────────────────────────────────────────
	/** Unique game identifier, used as DB `game_id` column value */
	id: string;
	/** Full display name */
	name: string;
	/** Short display name (for pills, badges, tabs) */
	shortName: string;
	/** Emoji or icon for quick visual identification */
	icon: string;

	// ── Card Number Extraction ─────────────────────────────────
	/** Extract a card number from raw OCR text. Returns null if no match.
	 *  Still used by /api/scan/+server.ts for post-Claude game-id detection. */
	extractCardNumber: (text: string) => string | null;

	// ── Config Bundles ─────────────────────────────────────────
	/** Scan quality and safety limits */
	scanConfig: ScanConfig;
	/** Recognition pipeline thresholds */
	pipelineConfig: PipelineConfig;

	// ── AI Identification (Tier 3 — Claude) ────────────────────
	// NOTE: Claude prompts and the card-id tool are deliberately NOT on
	// GameConfig. They're server-only and live in lib/games/<game>/prompt.ts,
	// imported directly by routes/api/scan/+server.ts. Putting them here
	// forces the client bundle to drag ~14KB of prompt strings through
	// the lazy-chunk path even though client code never reads them.

	// ── eBay Integration ───────────────────────────────────────
	/** Keywords to include in eBay searches for this game's cards */
	ebaySearchKeywords: readonly string[];

	// ── Theme ──────────────────────────────────────────────────
	/** Visual theme (colors, accents) */
	theme: GameTheme;

	// ── Navigation ─────────────────────────────────────────────
	/** Game-specific navigation items for the bottom nav */
	navItems: readonly GameNavItem[];
	/** Routes that require authentication for this game */
	protectedRoutes: readonly string[];
}
