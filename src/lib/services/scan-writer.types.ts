/**
 * Public input/output shapes for the scan-writer module. Imported by
 * scan-writer.ts (the only authorized writer) and by callers that need to
 * construct payloads (recognition.ts, scan confirmation flows, binder
 * coordinator).
 *
 * Splitting these out keeps scan-writer.ts focused on the persistence logic;
 * the type surface is large because each scan row carries ~50 telemetry
 * columns by design (see CLAUDE.md "Scans schema" section).
 */

export interface OpenSessionInput {
	gameId?: string;
	deviceModel?: string;
	osName?: string;
	osVersion?: string;
	browserName?: string;
	browserVersion?: string;
	appVersion?: string;
	viewportWidth?: number;
	viewportHeight?: number;
	deviceMemoryGb?: number;
	networkType?: string;
	capabilities?: Record<string, unknown>;
	extras?: Record<string, unknown>;
	netEffectiveType?: string | null;
	netDownlinkMbps?: number | null;
	netRttMs?: number | null;
	isPwaStandalone?: boolean | null;
	pageSessionAgeMs?: number | null;
	batteryLevel?: number | null;
	batteryCharging?: boolean | null;
	releaseGitSha?: string | null;
}

export interface RecordScanInput {
	sessionId: string;
	gameId?: string;
	photoStoragePath?: string | null;
	photoThumbnailPath?: string | null;
	photoBytes?: number | null;
	photoWidth?: number | null;
	photoHeight?: number | null;
	parentScanId?: string | null;
	retakeChainIdx?: number;
	captureContext?: Record<string, unknown>;
	qualitySignals?: Record<string, unknown>;
	captureLatencyMs?: number | null;
	extras?: Record<string, unknown>;
	photoBlob?: Blob | null;
	captureSource?:
		| 'camera_live'
		| 'camera_upload'
		| 'deck_upload'
		| 'sell_upload'
		| 'binder'
		| 'batch'
		| null;
	photoMimeType?: string | null;
	photoSha256?: Uint8Array | null;
	exifMake?: string | null;
	exifModel?: string | null;
	exifOrientation?: number | null;
	exifCaptureAt?: Date | null;
	exifSoftware?: string | null;
	cameraFacing?: 'user' | 'environment' | null;
	torchOn?: boolean | null;
	focusMode?: string | null;
	deviceOrientationBeta?: number | null;
	deviceOrientationGamma?: number | null;
	accelMagnitude?: number | null;
	blurLaplacianVariance?: number | null;
	luminanceMean?: number | null;
	luminanceStd?: number | null;
	overexposedPct?: number | null;
	underexposedPct?: number | null;
	edgeDensityCanny?: number | null;
	cardAreaPct?: number | null;
	perspectiveSkewDeg?: number | null;
	qualityGatePassed?: boolean | null;
	qualityGateFailReason?: string | null;
	decisionContext?: Record<string, unknown>;
}

/**
 * Active scan tier values. Pre-2.5 included `tier1_hash`, `tier1_embedding`,
 * and `tier2_ocr`; those engines were retired and historical rows tagged via
 * migration 010. The DB enum/CHECK still allows the legacy values for read
 * compatibility, but new writes are restricted to this narrowed set.
 *
 * NAMING NOTE: the live system has TWO tiers (local OCR + Claude fallback).
 * The DB string 'tier3_claude' is preserved from the original 3-tier design
 * for telemetry continuity. UI and docs refer to the Claude fallback as
 * "Tier 2" — only the DB string carries the legacy "tier3" name.
 */
export type ScanTier = 'tier3_claude';
export type LegacyScanTier = 'tier1_hash' | 'tier1_embedding' | 'tier2_ocr';

export type ScanEngine = 'claude_haiku' | 'claude_sonnet';
export type LegacyScanEngine =
	| 'phash' | 'dhash' | 'multicrop_hash'
	| 'mobileclip_v1' | 'dinov2_s14' | 'dinov2_base'
	| 'paddleocr_pp_v5' | 'tesseract_v5';

export interface RecordTierResultInput {
	scanId: string;
	tier: ScanTier;
	engine: ScanEngine;
	engineVersion: string;
	rawOutput: Record<string, unknown>;
	latencyMs?: number | null;
	costUsd?: number | null;
	errored?: boolean;
	errorMessage?: string | null;
	extras?: Record<string, unknown>;
	topnCandidates?: Array<Record<string, unknown>> | null;
	idbCacheHit?: boolean | null;
	sbExactHit?: boolean | null;
	sbFuzzyHit?: boolean | null;
	winnerDhashDistance?: number | null;
	winnerPhashDistance?: number | null;
	runnerUpMarginDhash?: number | null;
	hashMatchCount?: number | null;
	queryDhash?: string | null;
	queryPhash256?: string | null;
	ocrTextRaw?: string | null;
	ocrMeanConfidence?: number | null;
	ocrWordCount?: number | null;
	ocrDetectedCardNumber?: string | null;
	ocrOrientationDeg?: number | null;
	llmModelRequested?: string | null;
	llmModelResponded?: string | null;
	llmInputTokens?: number | null;
	llmOutputTokens?: number | null;
	llmCacheCreationTokens?: number | null;
	llmCacheReadTokens?: number | null;
	llmFinishReason?: string | null;
	pricingTableVersion?: string | null;
	promptTemplateSha?: string | null;
	promptTemplateVersion?: string | null;
	claudeReturnedNameInCatalog?: boolean | null;
	outcome?: string | null;
	skipReason?: string | null;
	errorCode?: string | null;
	ranAt?: Date | null;
}

/** Closed vocabulary mirroring the `scan_outcome` Postgres enum. */
export type ScanOutcome =
	| 'pending'
	| 'auto_confirmed'
	| 'user_confirmed'
	| 'user_corrected'
	| 'disputed'
	| 'abandoned'
	| 'timeout'
	| 'low_quality_rejected'
	| 'resolved';

export interface UpdateScanOutcomeInput {
	scanId: string;
	winningTier: string | null;
	finalCardId: string | null;
	finalConfidence: number | null;
	finalParallel: string | null;
	totalLatencyMs: number | null;
	totalCostUsd: number | null;
	userOverrode?: boolean;
	outcome: ScanOutcome;
	liveConsensusReached?: boolean | null;
	liveVsCanonicalAgreed?: boolean | null;
	fallbackTierUsed?: 'none' | 'haiku' | 'sonnet' | 'manual' | null;
	decisionContext?: Record<string, unknown> | null;
}

export interface RecordClaudeResponseInput {
	tierResultId: string;
	scanId: string;
	rawResponse: Record<string, unknown>;
	parsedOutput?: Record<string, unknown> | null;
	parseSuccess?: boolean | null;
	anthropicRequestId?: string | null;
}
