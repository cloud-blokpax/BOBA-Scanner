/**
 * GameConfig — the contract every game module must implement.
 *
 * All game-specific behavior lives behind this interface so the scanner,
 * recognition pipeline, UI, and API routes stay game-agnostic. New games
 * (Wonders, future Game 3) implement this interface and register in the resolver.
 */

import type Anthropic from '@anthropic-ai/sdk';

// ── OCR Region ─────────────────────────────────────────────────

/** A rectangular region on the card image where OCR should look for text. */
export interface OcrRegion {
	/** Fractional X offset from left (0.0–1.0) */
	x: number;
	/** Fractional Y offset from top (0.0–1.0) */
	y: number;
	/** Fractional width (0.0–1.0) */
	w: number;
	/** Fractional height (0.0–1.0) */
	h: number;
	/** Human-readable label for debugging */
	label: string;
}

// ── Scan Config ────────────────────────────────────────────────

/** Image quality and safety limits for the scan pipeline. */
export interface ScanConfig {
	/** JPEG quality for capture (0.0–1.0) */
	quality: number;
	/** Minimum Tesseract confidence to accept OCR result */
	ocrConfidenceThreshold: number;
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
	/** Tesseract worker restart interval (recognitions before restart) */
	ocrWorkerRestartInterval: number;
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

	// ── Card Number Extraction (Tier 2 — OCR) ──────────────────
	/** Known card number prefixes for this game (e.g., 'BF', 'PL', 'HTD') */
	knownPrefixes: ReadonlySet<string>;
	/** Extract a card number from raw OCR text. Returns null if no match. */
	extractCardNumber: (text: string) => string | null;

	// ── OCR Regions ────────────────────────────────────────────
	/** Regions on the card image where OCR should look for card numbers/text */
	ocrRegions: readonly OcrRegion[];

	// ── Config Bundles ─────────────────────────────────────────
	/** Scan quality and safety limits */
	scanConfig: ScanConfig;
	/** Recognition pipeline thresholds */
	pipelineConfig: PipelineConfig;

	// ── AI Identification (Tier 3 — Claude) ────────────────────
	/** Claude system prompt for card identification */
	claudeSystemPrompt: string;
	/** Claude user prompt template. Receives `{base64}` image data. */
	claudeUserPrompt: string;
	/** Anthropic tool definition for structured card identification output */
	cardIdTool: Anthropic.Messages.Tool;

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
