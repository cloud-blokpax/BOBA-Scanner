/**
 * Scan history writer — the SOLE module authorized to persist scan data
 * to Supabase.
 *
 * Every shutter-press produces one scan_sessions row (shared across all
 * scans within a camera-mount), one scans row, and N scan_tier_results
 * rows (one per tier attempt).
 *
 * No other module in the codebase writes to the scan_* tables. If you
 * find yourself wanting a direct INSERT, add a function here instead.
 *
 * All four exported functions swallow errors and return null/void on
 * failure. Persistence must never break a user's scan — the scan
 * completing is worth more than any single telemetry row.
 *
 * Uses the authenticated user's Supabase client (not service_role), so
 * the RLS policies shipped in Phase 0.1 enforce ownership and shape.
 */

import { getSupabase } from '$lib/services/supabase';
import { PIPELINE_VERSION } from '$lib/services/pipeline-version';
import { userId } from '$lib/stores/auth.svelte';
import { coerceHumanReadableParallel } from '$lib/data/wonders-parallels';

/**
 * Session 1.2: schema bump signal for the enriched scans-row shape. Every
 * insert that includes the new telemetry columns stamps this value so
 * downstream readers can distinguish pre- and post-1.2 rows.
 */
const SCAN_SCHEMA_VERSION = 2 as const;

// ---------- Public input types ----------

export interface OpenSessionInput {
	gameId?: string;                 // defaults to 'boba'
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

	// ── NEW (Session 1.2) ──
	/** Network Information API effective type (e.g. '4g', '3g'). Chrome/Edge only. */
	netEffectiveType?: string | null;
	/** Downlink estimate in Mbps. Chrome/Edge only. */
	netDownlinkMbps?: number | null;
	/** Round-trip time estimate in ms. Chrome/Edge only. */
	netRttMs?: number | null;
	/** Is the page running as an installed PWA? */
	isPwaStandalone?: boolean | null;
	/** Age of the current page session in ms at the time the scan session opened. */
	pageSessionAgeMs?: number | null;
	/** Battery level 0..1. Chrome only. */
	batteryLevel?: number | null;
	/** Whether the device is charging. Chrome only. */
	batteryCharging?: boolean | null;
	/** Deploy git SHA (set at build time via env var). */
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

	/**
	 * Optional source photo. If provided, uploaded asynchronously to
	 * scan-images/{user_id}/{scan_id}.jpg and the path patched back
	 * into the scans row. Upload failure does not fail the scan.
	 */
	photoBlob?: Blob | null;

	// ── NEW (Session 1.2) ──

	// Capture source identity
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

	// EXIF (non-PII subset — GPS never captured)
	exifMake?: string | null;
	exifModel?: string | null;
	exifOrientation?: number | null;
	exifCaptureAt?: Date | null;
	exifSoftware?: string | null;

	// Device/camera state at shutter
	cameraFacing?: 'user' | 'environment' | null;
	torchOn?: boolean | null;
	focusMode?: string | null;
	deviceOrientationBeta?: number | null;
	deviceOrientationGamma?: number | null;
	accelMagnitude?: number | null;

	// Image quality signals
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

	// Decision context (replay / counterfactual)
	decisionContext?: Record<string, unknown>;
}

/**
 * Active scan tier values. Pre-2.5 included `tier1_hash`, `tier1_embedding`,
 * and `tier2_ocr`; those engines were retired and historical rows tagged via
 * migration 010. The DB enum/CHECK still allows the legacy values for read
 * compatibility, but new writes are restricted to this narrowed set.
 *
 * `LegacyScanTier` is exported separately for telemetry readers that still
 * need to render historical rows (see AdminPhase2Tab tierLabel).
 */
export type ScanTier = 'tier3_claude';
export type LegacyScanTier = 'tier1_hash' | 'tier1_embedding' | 'tier2_ocr';

/**
 * Active engine values. Tier 1 PaddleOCR runs entirely client-side and never
 * writes scan_tier_results rows (its telemetry lives in scans.decision_context
 * JSONB), so `paddleocr_pp_v5` is intentionally excluded. Add it back if/when
 * a Tier 1 row-write path is added.
 */
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

	// ── NEW (Session 1.2) ──

	// Hash-tier specifics
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

	// OCR-tier specifics
	ocrTextRaw?: string | null;
	ocrMeanConfidence?: number | null;
	ocrWordCount?: number | null;
	ocrDetectedCardNumber?: string | null;
	ocrOrientationDeg?: number | null;

	// LLM-tier specifics
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

	// Shared outcome telemetry
	outcome?: string | null;
	skipReason?: string | null;
	errorCode?: string | null;
	ranAt?: Date | null;
}

/** Closed vocabulary mirroring the `scan_outcome` Postgres enum. Pinned here
 *  so callers can't free-text new values — Postgres will reject anything
 *  outside this set with 22P02. */
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
	/** Allow nullable: failure paths (blur reject, no match, abandoned) have
	 *  no winning tier. Persisted as null so the dashboard's `null_abandoned`
	 *  bucket reflects reality. */
	winningTier: string | null;
	/** Allow nullable: failure paths have no card. */
	finalCardId: string | null;
	finalConfidence: number | null;
	/** Human-readable parallel name (e.g. "Classic Foil"). Mirrors cards.parallel
	 *  for the matched card. */
	finalParallel: string | null;
	totalLatencyMs: number | null;
	totalCostUsd: number | null;
	userOverrode?: boolean;
	/** Required. Maps to scans.outcome (Postgres enum). Defaults applied at
	 *  call site, not here, so each call site owns the semantic. */
	outcome: ScanOutcome;
	// Session 2.1a live-OCR telemetry (schema applied via MCP).
	liveConsensusReached?: boolean | null;
	liveVsCanonicalAgreed?: boolean | null;
	fallbackTierUsed?: 'none' | 'haiku' | 'sonnet' | 'manual' | null;
	/** Optional replacement for decision_context JSONB. Merges with the
	 *  baseline context set on insert (threshold values). Callers should
	 *  include the baseline keys too if they want to preserve them. */
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

// ---------- Module-level session cache ----------

let _activeSessionId: string | null = null;
let _activeSessionOpenedAt = 0;
const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/** Reset the cached session. Call on logout or scan-page unmount. */
export function resetActiveSession(): void {
	_activeSessionId = null;
	_activeSessionOpenedAt = 0;
}

// ---------- Helpers ----------

function logFailure(where: string, err: unknown, ctx: Record<string, unknown> = {}): void {
	const message = err instanceof Error ? err.message
		: typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message)
		: String(err);
	console.debug(`[scan-writer] ${where} failed`, { ...ctx, error: message });

	// Also persist to app_events. Lazy-imported to avoid pulling the
	// diagnostics module into the scan-writer's import graph for users
	// who never trip a logFailure path.
	void import('$lib/services/diagnostics').then(({ logFailure: logToEvents }) => {
		logToEvents(`scan_writer.${where}`, err, ctx);
	}).catch(() => { /* logger failures must never escape */ });
}

/**
 * Collect what the browser tells us about the device/session. Safe on SSR
 * (all guarded by typeof window checks).
 */
function collectBrowserCapabilities(): OpenSessionInput {
	if (typeof window === 'undefined') return {};
	const nav = window.navigator;
	// Network Information API — non-standard, present in Chrome/Edge
	const connection = (nav as unknown as {
		connection?: { effectiveType?: string };
	}).connection;
	return {
		browserName: inferBrowserName(nav.userAgent),
		osName: inferOsName(nav.userAgent),
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight,
		deviceMemoryGb: (nav as unknown as { deviceMemory?: number }).deviceMemory,
		networkType: connection?.effectiveType,
		capabilities: {
			hasServiceWorker: 'serviceWorker' in nav,
			hasWebGL: detectWebGL(),
			hasWebGPU: 'gpu' in nav,
			hasWasmSIMD: detectWasmSIMD(),
			hasAccelerometer: 'DeviceMotionEvent' in window,
			userAgent: nav.userAgent
		}
	};
}

function inferBrowserName(ua: string): string {
	if (ua.includes('Edg/')) return 'Edge';
	if (ua.includes('Chrome/')) return 'Chrome';
	if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
	if (ua.includes('Firefox/')) return 'Firefox';
	return 'Unknown';
}

function inferOsName(ua: string): string {
	if (/Android/.test(ua)) return 'Android';
	if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
	if (/Mac OS X/.test(ua)) return 'macOS';
	if (/Windows/.test(ua)) return 'Windows';
	if (/Linux/.test(ua)) return 'Linux';
	return 'Unknown';
}

function detectWebGL(): boolean {
	try {
		const canvas = document.createElement('canvas');
		return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
	} catch { return false; }
}

function detectWasmSIMD(): boolean {
	try {
		// Tiny SIMD-required module; will throw on decode if SIMD unsupported
		return WebAssembly.validate(new Uint8Array([
			0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
			10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
		]));
	} catch { return false; }
}

// ---------- Public API ----------

/**
 * Open a new scan session, or return the cached active one.
 * Call from the scanner on mount / first-scan. Subsequent scans in the
 * same session reuse the ID — no extra round-trip.
 */
export async function getOrOpenActiveSession(
	input: OpenSessionInput = {}
): Promise<string | null> {
	const now = Date.now();
	if (_activeSessionId && now - _activeSessionOpenedAt < SESSION_MAX_AGE_MS) {
		return _activeSessionId;
	}

	const uid = userId();
	if (!uid) return null; // anonymous scans don't persist in Phase 0.3

	const client = getSupabase();
	if (!client) return null;

	try {
		const browserCaps = collectBrowserCapabilities();
		const { data, error } = await client
			.from('scan_sessions')
			.insert({
				user_id: uid,
				game_id: input.gameId ?? 'boba',
				device_model: input.deviceModel ?? null,
				os_name: input.osName ?? browserCaps.osName ?? null,
				os_version: input.osVersion ?? null,
				browser_name: input.browserName ?? browserCaps.browserName ?? null,
				browser_version: input.browserVersion ?? null,
				app_version: input.appVersion ?? null,
				viewport_width: input.viewportWidth ?? browserCaps.viewportWidth ?? null,
				viewport_height: input.viewportHeight ?? browserCaps.viewportHeight ?? null,
				device_memory_gb: input.deviceMemoryGb ?? browserCaps.deviceMemoryGb ?? null,
				network_type: input.networkType ?? browserCaps.networkType ?? null,
				capabilities: { ...browserCaps.capabilities, ...input.capabilities },
				extras: input.extras ?? {},

				// ── Session 1.2 telemetry ──
				net_effective_type: input.netEffectiveType ?? null,
				net_downlink_mbps: input.netDownlinkMbps ?? null,
				net_rtt_ms: input.netRttMs ?? null,
				is_pwa_standalone: input.isPwaStandalone ?? null,
				page_session_age_ms: input.pageSessionAgeMs ?? null,
				battery_level: input.batteryLevel ?? null,
				battery_charging: input.batteryCharging ?? null,
				release_git_sha: input.releaseGitSha ?? null
			})
			.select('id')
			.single();

		if (error || !data) {
			logFailure('openSession', error ?? new Error('no row returned'), { userId: uid });
			return null;
		}

		_activeSessionId = data.id;
		_activeSessionOpenedAt = now;
		return _activeSessionId;
	} catch (err) {
		logFailure('openSession', err, { userId: uid });
		return null;
	}
}

/**
 * Record a shutter-press. Call once per scan attempt, before any tier runs.
 * Returns the scan_id to pass to recordTierResult.
 * Returns null on any failure — caller should skip tier persistence if null.
 */
export async function recordScan(input: RecordScanInput): Promise<string | null> {
	const uid = userId();
	if (!uid) return null;

	const client = getSupabase();
	if (!client) return null;

	try {
		const { data, error } = await client
			.from('scans')
			.insert({
				session_id: input.sessionId,
				user_id: uid,
				game_id: input.gameId ?? 'boba',
				photo_storage_path: input.photoStoragePath ?? null,
				photo_thumbnail_path: input.photoThumbnailPath ?? null,
				photo_bytes: input.photoBytes ?? null,
				photo_width: input.photoWidth ?? null,
				photo_height: input.photoHeight ?? null,
				parent_scan_id: input.parentScanId ?? null,
				retake_chain_idx: input.retakeChainIdx ?? 0,
				capture_context: input.captureContext ?? {},
				quality_signals: input.qualitySignals ?? {},
				outcome: 'pending',
				pipeline_version: PIPELINE_VERSION,
				capture_latency_ms: input.captureLatencyMs ?? null,
				extras: input.extras ?? {},

				// ── Session 1.2 telemetry ──

				// Capture source identity
				capture_source: input.captureSource ?? null,
				photo_mime_type: input.photoMimeType ?? null,
				photo_sha256: input.photoSha256 ?? null,

				// EXIF — GPS never written; privacy invariant enforced here
				exif_make: input.exifMake ?? null,
				exif_model: input.exifModel ?? null,
				exif_orientation: input.exifOrientation ?? null,
				exif_capture_at: input.exifCaptureAt ? input.exifCaptureAt.toISOString() : null,
				exif_software: input.exifSoftware ?? null,
				exif_gps_stripped: true,

				// Device/camera state at shutter
				camera_facing: input.cameraFacing ?? null,
				torch_on: input.torchOn ?? null,
				focus_mode: input.focusMode ?? null,
				device_orientation_beta: input.deviceOrientationBeta ?? null,
				device_orientation_gamma: input.deviceOrientationGamma ?? null,
				accel_magnitude: input.accelMagnitude ?? null,

				// Image quality signals
				blur_laplacian_variance: input.blurLaplacianVariance ?? null,
				luminance_mean: input.luminanceMean ?? null,
				luminance_std: input.luminanceStd ?? null,
				overexposed_pct: input.overexposedPct ?? null,
				underexposed_pct: input.underexposedPct ?? null,
				edge_density_canny: input.edgeDensityCanny ?? null,
				card_area_pct: input.cardAreaPct ?? null,
				perspective_skew_deg: input.perspectiveSkewDeg ?? null,
				quality_gate_passed: input.qualityGatePassed ?? null,
				quality_gate_fail_reason: input.qualityGateFailReason ?? null,

				// Decision context for replay / counterfactual analysis
				decision_context: input.decisionContext ?? {},

				// Bump signals the new-shape insert
				schema_version: SCAN_SCHEMA_VERSION
			})
			.select('id')
			.single();

		if (error || !data) {
			logFailure('recordScan', error ?? new Error('no row returned'), {
				userId: uid,
				sessionId: input.sessionId
			});
			return null;
		}

		// Fire-and-forget photo upload if a blob was supplied.
		// The scan row exists now; upload success patches in the path.
		if (input.photoBlob) {
			// eslint-disable-next-line no-void
			void uploadScanPhoto(data.id, uid, input.photoBlob);
		}

		return data.id;
	} catch (err) {
		logFailure('recordScan', err, { userId: uid, sessionId: input.sessionId });
		return null;
	}
}

/**
 * Record one engine's output for a given scan. Fire-and-forget.
 * Multiple calls per scan_id are expected (one per tier attempt).
 * Returns the new row's id on success, null on failure — callers that
 * need to link a downstream row (e.g., scan_claude_responses) use it.
 */
export async function recordTierResult(input: RecordTierResultInput): Promise<string | null> {
	const uid = userId();
	if (!uid) return null;

	const client = getSupabase();
	if (!client) return null;

	try {
		const { data, error } = await client.from('scan_tier_results').insert({
			scan_id: input.scanId,
			user_id: uid,
			tier: input.tier,
			engine: input.engine,
			engine_version: input.engineVersion,
			raw_output: input.rawOutput,
			latency_ms: input.latencyMs ?? null,
			cost_usd: input.costUsd ?? null,
			errored: input.errored ?? false,
			error_message: input.errorMessage ?? null,
			extras: input.extras ?? {},

			// ── Session 1.2 telemetry ──
			topn_candidates: input.topnCandidates ?? null,
			idb_cache_hit: input.idbCacheHit ?? null,
			sb_exact_hit: input.sbExactHit ?? null,
			sb_fuzzy_hit: input.sbFuzzyHit ?? null,
			winner_dhash_distance: input.winnerDhashDistance ?? null,
			winner_phash_distance: input.winnerPhashDistance ?? null,
			runner_up_margin_dhash: input.runnerUpMarginDhash ?? null,
			hash_match_count: input.hashMatchCount ?? null,
			query_dhash: input.queryDhash ?? null,
			query_phash_256: input.queryPhash256 ?? null,

			ocr_text_raw: input.ocrTextRaw ?? null,
			ocr_mean_confidence: input.ocrMeanConfidence ?? null,
			ocr_word_count: input.ocrWordCount ?? null,
			ocr_detected_card_number: input.ocrDetectedCardNumber ?? null,
			ocr_orientation_deg: input.ocrOrientationDeg ?? null,

			llm_model_requested: input.llmModelRequested ?? null,
			llm_model_responded: input.llmModelResponded ?? null,
			llm_input_tokens: input.llmInputTokens ?? null,
			llm_output_tokens: input.llmOutputTokens ?? null,
			llm_cache_creation_tokens: input.llmCacheCreationTokens ?? null,
			llm_cache_read_tokens: input.llmCacheReadTokens ?? null,
			llm_finish_reason: input.llmFinishReason ?? null,
			pricing_table_version: input.pricingTableVersion ?? null,
			prompt_template_sha: input.promptTemplateSha ?? null,
			prompt_template_version: input.promptTemplateVersion ?? null,
			claude_returned_name_in_catalog: input.claudeReturnedNameInCatalog ?? null,

			outcome: input.outcome ?? null,
			skip_reason: input.skipReason ?? null,
			error_code: input.errorCode ?? null,
			ran_at: input.ranAt ? input.ranAt.toISOString() : null
		}).select('id').single();

		if (error || !data) {
			logFailure('recordTierResult', error ?? new Error('no row returned'), {
				scanId: input.scanId,
				tier: input.tier,
				engine: input.engine
			});
			return null;
		}
		return data.id;
	} catch (err) {
		logFailure('recordTierResult', err, {
			scanId: input.scanId,
			tier: input.tier,
			engine: input.engine
		});
		return null;
	}
}

/**
 * Persist the raw Claude response for a Tier 3 tier_result row.
 * Fire-and-forget. One row per Tier 3 attempt. Never blocks scan completion.
 * The `rawResponse` jsonb is stored as-is; column-level compression handles
 * size, and no field redaction is performed (no PII is present at this layer).
 */
export async function recordClaudeResponse(
	input: RecordClaudeResponseInput
): Promise<void> {
	const uid = userId();
	if (!uid) return;

	const client = getSupabase();
	if (!client) return;

	try {
		const { error } = await client.from('scan_claude_responses').insert({
			tier_result_id: input.tierResultId,
			scan_id: input.scanId,
			user_id: uid,
			raw_response: input.rawResponse,
			parsed_output: input.parsedOutput ?? null,
			parse_success: input.parseSuccess ?? null,
			anthropic_request_id: input.anthropicRequestId ?? null
		});
		if (error) {
			logFailure('recordClaudeResponse', error, {
				scanId: input.scanId,
				tierResultId: input.tierResultId
			});
		}
	} catch (err) {
		logFailure('recordClaudeResponse', err, {
			scanId: input.scanId,
			tierResultId: input.tierResultId
		});
	}
}

/**
 * Update a scan row after the recognition pipeline resolves. Sets the
 * winning-tier / final-card / total-latency fields that were unknown at
 * INSERT time (the scan row is written BEFORE tiers run so tier_results
 * can FK to it).
 *
 * Fire-and-forget. Never throws. Logs and returns silently on failure.
 *
 * IMPORTANT: the `outcome` field is a Postgres enum (scan_outcome).
 * Valid values: pending, auto_confirmed, user_confirmed, user_corrected,
 * disputed, abandoned, timeout, low_quality_rejected, resolved.
 * Any value outside this list → Postgres rejects the UPDATE with 22P02,
 * logFailure swallows the error, and EVERY finalization field stays null.
 * Add new values via ALTER TYPE migration before using them here.
 */
export async function updateScanOutcome(input: UpdateScanOutcomeInput): Promise<void> {
	const client = getSupabase();
	if (!client) return;

	try {
		// Defensive coercion at the persistence boundary. In a healthy
		// pipeline every parallel reaching this point is already human-readable;
		// this exists to turn a short-code leak into a logged warning + correct
		// value rather than a silently-corrupt DB row. See
		// `$lib/data/wonders-parallels.ts` for the canonical mapping.
		const safeParallel = coerceHumanReadableParallel(
			input.finalParallel,
			'scan-writer/updateScanOutcome'
		);
		const updates: Record<string, unknown> = {
			winning_tier: input.winningTier,
			final_card_id: input.finalCardId,
			final_confidence: input.finalConfidence,
			final_parallel: safeParallel,
			total_latency_ms: input.totalLatencyMs,
			total_cost_usd: input.totalCostUsd,
			user_overrode: input.userOverrode ?? false,
			outcome: input.outcome
		};
		if (input.liveConsensusReached !== undefined) {
			updates.live_consensus_reached = input.liveConsensusReached;
		}
		if (input.liveVsCanonicalAgreed !== undefined) {
			updates.live_vs_canonical_agreed = input.liveVsCanonicalAgreed;
		}
		if (input.fallbackTierUsed !== undefined) {
			updates.fallback_tier_used = input.fallbackTierUsed;
		}
		if (input.decisionContext) {
			updates.decision_context = input.decisionContext;
		}
		const { error } = await client
			.from('scans')
			.update(updates)
			.eq('id', input.scanId);
		if (error) {
			logFailure('updateScanOutcome', error, { scanId: input.scanId });
		}
	} catch (err) {
		logFailure('updateScanOutcome', err, { scanId: input.scanId });
	}
}

/** Close the active session (or a specific one). */
export async function closeSession(sessionId?: string): Promise<void> {
	const targetId = sessionId ?? _activeSessionId;
	if (!targetId) return;

	const client = getSupabase();
	if (!client) return;

	try {
		const { error } = await client
			.from('scan_sessions')
			.update({ ended_at: new Date().toISOString() })
			.eq('id', targetId);
		if (error) logFailure('closeSession', error, { sessionId: targetId });
	} catch (err) {
		logFailure('closeSession', err, { sessionId: targetId });
	}

	if (targetId === _activeSessionId) resetActiveSession();
}

/**
 * Upload a scan's source photo to Supabase Storage and patch the path
 * back into the scans row.
 *
 * Best-effort. Never throws. Logs and returns silently on failure.
 * Runs asynchronously from recordScan — the caller doesn't await this.
 *
 * Path: scan-images/{user_id}/{scan_id}.jpg
 * Compression: resized to max 1024px long-edge, JPEG quality 0.85
 */
async function uploadScanPhoto(scanId: string, uid: string, blob: Blob): Promise<void> {
	const client = getSupabase();
	if (!client) return;

	try {
		// Resize in a canvas — keeps upload size predictable.
		const resized = await resizeBlobForUpload(blob, 1024, 0.85);
		if (!resized) {
			logFailure('uploadScanPhoto.resize', new Error('resize returned null'), { scanId });
			return;
		}

		const path = `${uid}/${scanId}.jpg`;
		const { error: uploadErr } = await client.storage
			.from('scan-images')
			.upload(path, resized, {
				contentType: 'image/jpeg',
				upsert: true,
				cacheControl: '3600'
			});

		if (uploadErr) {
			logFailure('uploadScanPhoto.upload', uploadErr, { scanId, path });
			return;
		}

		// Patch the scans row with the storage path + size.
		const patchClient = getSupabase();
		if (!patchClient) return;
		const { error: updateErr } = await patchClient
			.from('scans')
			.update({
				photo_storage_path: path,
				photo_bytes: resized.size
			})
			.eq('id', scanId);

		if (updateErr) {
			logFailure('uploadScanPhoto.patchPath', updateErr, { scanId, path });
		}
	} catch (err) {
		logFailure('uploadScanPhoto', err, { scanId });
	}
}

/**
 * Resize a Blob to max `maxLongEdge` pixels, JPEG-encoded at `quality`.
 * Returns null if the input can't be decoded.
 *
 * Uses ImageBitmap + OffscreenCanvas when available for Worker-safety.
 * Falls back to HTMLCanvas in environments that don't support Offscreen.
 */
async function resizeBlobForUpload(
	blob: Blob,
	maxLongEdge: number,
	quality: number
): Promise<Blob | null> {
	try {
		const bitmap = await createImageBitmap(blob);
		const longEdge = Math.max(bitmap.width, bitmap.height);
		const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
		const width = Math.round(bitmap.width * scale);
		const height = Math.round(bitmap.height * scale);

		// Prefer OffscreenCanvas; fall back to HTMLCanvas on Safari < 16.4
		if (typeof OffscreenCanvas !== 'undefined') {
			const canvas = new OffscreenCanvas(width, height);
			const ctx = canvas.getContext('2d');
			if (!ctx) { bitmap.close(); return null; }
			ctx.drawImage(bitmap, 0, 0, width, height);
			bitmap.close();
			return await canvas.convertToBlob({ type: 'image/jpeg', quality });
		}

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) { bitmap.close(); return null; }
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		return await new Promise<Blob | null>(resolve =>
			canvas.toBlob(b => resolve(b), 'image/jpeg', quality)
		);
	} catch (err) {
		console.debug('[scan-writer] resize failed', err);
		return null;
	}
}
