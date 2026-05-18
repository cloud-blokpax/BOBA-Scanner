/**
 * Recognition Pipeline — Tier Functions
 *
 * Tier 2: Claude API → cross-validation against local DB
 *
 * Session 2.5 retired the legacy hash-cache and Tesseract OCR paths.
 * Phase 2 canonical local OCR now owns Tier 1; the Claude-Haiku fallback
 * is Tier 2 in the active 2-tier pipeline. The DB string stored on
 * `scan_tier_results.tier` is still 'tier3_claude' for telemetry
 * continuity with the original 3-tier design — see scan-writer.ts.
 *
 * runTier2 returns ScanResult | null. Null means "no match".
 */

import { idb } from './idb';
import { getAllCards } from './card-db';
import { getImageWorker } from './recognition-workers';
import { crossValidateCardResult } from './recognition-validation';
import { validateCatalogTriangulation } from './catalog-validation';
import {
	recordTierResult as writerRecordTierResult,
	writeTier1Result
} from './scan-writer';
import { runCanonicalTier1, type CanonicalResult } from './tier1-canonical';
import { tryLiveShortCircuit } from './tier1-short-circuit';
import { featureEnabled } from '$lib/stores/feature-flags.svelte';
import { runUploadPipeline } from './upload-pipeline';
import { toParallelName } from '$lib/data/wonders-parallels';
import { checkpoint } from './scan-checkpoint';
import { buildTier1TelemetryPayload } from './tier1-telemetry';
import type { Tier1PathTaken } from './tier1-telemetry.types';
import type { LiveOCRSnapshot } from './live-ocr-coordinator';
import type { Card, ScanResult } from '$lib/types';

// ── Shared types ────────────────────────────────────────────

export interface ScanContext {
	traceId: string;
	lastTier2FailReason: string | null;
	cropRegion?: { x: number; y: number; width: number; height: number } | null;
	/** Game hint for scoping Claude prompts + Phase 2 canonical OCR. Defaults to 'boba'. */
	gameHint: string;
	/** Phase 1 Doc 1.1 — Tier 2 gate outcome captured for the abandon
	 *  patch. Null when the gate didn't fire. */
	tier2GateOutcome?: {
		passed: boolean;
		reason: string | null;
		gated: boolean;
	} | null;
}

// ── Per-tier telemetry (Session 1.2-tier-miss-telemetry) ────

/** Telemetry accumulated by runTier2 (the Claude-Haiku fallback). */
export interface Tier2Telemetry {
	attempted: boolean;
	skipReason: string | null;
	imageBytesUploaded: number | null;
	/** Phase 2 Doc 2.6. TRUE when Tier 2 sent the EXIF-rotated original
	 *  instead of the canonical crop because detectCard failed. NULL when
	 *  Tier 2 didn't run. */
	detectionFailedFallbackUsed?: boolean | null;
	llmModelRequested: string | null;
	llmModelResponded: string | null;
	llmInputTokens: number | null;
	llmOutputTokens: number | null;
	llmCacheCreationTokens: number | null;
	llmCacheReadTokens: number | null;
	llmFinishReason: string | null;
	httpStatus: number | null;
	anthropicRequestId: string | null;
	rawResponse: Record<string, unknown> | null;
	parseSuccess: boolean;
	claudeReturnedNameInCatalog: boolean | null;
	outcome: 'hit' | 'miss' | 'error';
	errorMessage: string | null;
	latencyMs: number;
}

export function emptyTier2Telemetry(): Tier2Telemetry {
	return {
		attempted: false,
		skipReason: null,
		imageBytesUploaded: null,
		detectionFailedFallbackUsed: null,
		llmModelRequested: null,
		llmModelResponded: null,
		llmInputTokens: null,
		llmOutputTokens: null,
		llmCacheCreationTokens: null,
		llmCacheReadTokens: null,
		llmFinishReason: null,
		httpStatus: null,
		anthropicRequestId: null,
		rawResponse: null,
		parseSuccess: false,
		claudeReturnedNameInCatalog: null,
		outcome: 'miss',
		errorMessage: null,
		latencyMs: 0
	};
}

export async function emitTier2Result(scanId: string, t: Tier2Telemetry): Promise<void> {
	// Cost calc for Haiku 4.5 — duplicates the per-row sum done in
	// recognition.ts's finalize(). Fold into a shared helper when the
	// AI Gateway lands and replaces this hand-rolled pricing table.
	const costUsd =
		t.llmInputTokens !== null && t.llmOutputTokens !== null
			? (t.llmInputTokens * 1.0 + t.llmOutputTokens * 5.0) / 1_000_000
			: null;

	await writerRecordTierResult({
		scanId,
		// 'tier3_claude' is the legacy DB string for the Claude Haiku fallback,
		// preserved for telemetry continuity. The active pipeline calls this
		// Tier 2 in code/UI; only the DB value carries the original "tier3" name.
		tier: 'tier3_claude',
		engine: 'claude_haiku',
		engineVersion: t.llmModelResponded ?? 'claude-haiku-4-5-20251001',
		rawOutput: (t.rawResponse ?? {}) as Record<string, unknown>,
		latencyMs: t.latencyMs,
		costUsd,
		errored: t.outcome === 'error',
		errorMessage: t.errorMessage,
		outcome: t.outcome,
		skipReason: t.skipReason,
		ranAt: new Date(),
		llmModelRequested: t.llmModelRequested,
		llmModelResponded: t.llmModelResponded,
		llmInputTokens: t.llmInputTokens,
		llmOutputTokens: t.llmOutputTokens,
		llmCacheCreationTokens: t.llmCacheCreationTokens,
		llmCacheReadTokens: t.llmCacheReadTokens,
		llmFinishReason: t.llmFinishReason,
		promptTemplateVersion: 'phase2.5',
		pricingTableVersion: 'haiku-4.5-2026-04',
		claudeReturnedNameInCatalog: t.claudeReturnedNameInCatalog
	});
}

/**
 * Resolve a scanIdPromise to a scan id, swallowing rejections. Used inside
 * tier finally blocks where a scan-id lookup failure must not propagate.
 */
async function resolveScanId(p: Promise<string | null>): Promise<string | null> {
	try {
		return await p;
	} catch {
		return null;
	}
}

// ── Utilities ───────────────────────────────────────────────

/** Race a promise against a timeout. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
		)
	]);
}

// ── Tier 2: Claude API ──────────────────────────────────────

/**
 * Phase 2 Doc 2.6 — options bag for runTier2. `detectionFailedFallbackBitmap`
 * is the EXIF-rotated original; when present, runTier2 sends THIS to Haiku
 * instead of the canonical-stretched bitmap. Used when detectCard returned
 * centered_fallback and the canonical crop would lose small-text resolution.
 */
export interface Tier2Options {
	detectionFailedFallbackBitmap?: ImageBitmap | null;
}

export async function runTier2(
	bitmap: ImageBitmap,
	ctx: ScanContext,
	telemetry: Tier2Telemetry = emptyTier2Telemetry(),
	scanIdPromise: Promise<string | null> = Promise.resolve(null),
	options: Tier2Options = {}
): Promise<ScanResult | null> {
	const started = performance.now();
	ctx.lastTier2FailReason = null;
	telemetry.attempted = true;
	telemetry.llmModelRequested = 'claude-haiku-4-5-20251001';

	try {
	// Resize and send to API
	let response: Response;
	try {
		// Phase 2 Doc 2.6 — when card detection failed, prefer the EXIF-rotated
		// original over the canonical crop. The canonical's drawImageCrop path
		// stretches an 85%-of-frame rect to 750×1050, which downsamples small
		// text below Haiku's reliable-read threshold. The EXIF-rotated original
		// retains card-resolution. resizeForUpload caps long edge at 1024 either
		// way, so payload size stays bounded.
		const uploadBitmap = options.detectionFailedFallbackBitmap ?? bitmap;
		if (options.detectionFailedFallbackBitmap) {
			console.debug(`[scan:${ctx.traceId}:tier2] Detection failed — sending EXIF-rotated original (${uploadBitmap.width}×${uploadBitmap.height}) to Haiku`);
			telemetry.detectionFailedFallbackUsed = true;
		} else {
			telemetry.detectionFailedFallbackUsed = false;
		}
		const imageBlob = await getImageWorker().resizeForUpload(uploadBitmap, 1024);
		telemetry.imageBytesUploaded = imageBlob.size;
		console.debug(`[scan:${ctx.traceId}:tier2] Image resized for upload: ${(imageBlob.size / 1024).toFixed(1)}KB`);
		const formData = new FormData();
		formData.append('image', imageBlob, 'scan.jpg');
		if (ctx.gameHint) {
			formData.append('game_id', ctx.gameHint);
		}
		response = await fetch('/api/scan', { method: 'POST', body: formData });
		telemetry.httpStatus = response.status;
	} catch (err) {
		console.error(`[scan:${ctx.traceId}:tier2] Network error calling /api/scan:`, err);
		ctx.lastTier2FailReason = 'Network error reaching scan API';
		telemetry.outcome = 'error';
		telemetry.errorMessage = err instanceof Error ? err.message : String(err);
		telemetry.latencyMs = Math.round(performance.now() - started);
		return null;
	}

	// Handle non-OK responses
	if (!response.ok) {
		let errorBody = '';
		try { errorBody = await response.text(); } catch { /* ignore */ }
		console.error(`[scan:${ctx.traceId}:tier2] API returned ${response.status}: ${errorBody}`);
		if (response.status === 401) ctx.lastTier2FailReason = 'Not authenticated — please sign in';
		else if (response.status === 429) ctx.lastTier2FailReason = 'Rate limited — please wait before scanning again';
		else if (response.status === 503) ctx.lastTier2FailReason = 'AI service overloaded — try again in a moment';
		else ctx.lastTier2FailReason = `Scan API error (${response.status})`;
		telemetry.outcome = 'error';
		telemetry.errorMessage = `HTTP ${response.status}`;
		telemetry.latencyMs = Math.round(performance.now() - started);
		return null;
	}

	// Parse response
	let result;
	try {
		result = await response.json();
		telemetry.parseSuccess = true;
	} catch (err) {
		console.debug(`[scan:${ctx.traceId}:tier2] API response JSON parse failed:`, err);
		console.error(`[scan:${ctx.traceId}:tier2] Invalid JSON in API response`);
		ctx.lastTier2FailReason = 'Invalid response from scan API';
		telemetry.outcome = 'error';
		telemetry.parseSuccess = false;
		telemetry.errorMessage = 'JSON parse failed';
		telemetry.latencyMs = Math.round(performance.now() - started);
		return null;
	}

	// Capture raw response + Anthropic meta regardless of success/failure so
	// diagnostics have the full picture for every Tier 2 run.
	telemetry.rawResponse = result as Record<string, unknown>;
	if (result && typeof result.meta === 'object' && result.meta !== null) {
		const meta = result.meta as Record<string, unknown>;
		telemetry.llmModelResponded = typeof meta.model === 'string' ? meta.model : null;
		telemetry.llmInputTokens = typeof meta.input_tokens === 'number' ? meta.input_tokens : null;
		telemetry.llmOutputTokens = typeof meta.output_tokens === 'number' ? meta.output_tokens : null;
		telemetry.llmCacheCreationTokens = typeof meta.cache_creation_tokens === 'number' ? meta.cache_creation_tokens : null;
		telemetry.llmCacheReadTokens = typeof meta.cache_read_tokens === 'number' ? meta.cache_read_tokens : null;
		telemetry.llmFinishReason = typeof meta.finish_reason === 'string' ? meta.finish_reason : null;
		telemetry.anthropicRequestId = typeof meta.anthropic_request_id === 'string' ? meta.anthropic_request_id : null;
	}

	console.debug(`[scan:${ctx.traceId}:tier2] API response:`, JSON.stringify(result, null, 2));

	if (!result.success || !result.card) {
		console.warn(`[scan:${ctx.traceId}:tier2] API returned success=false or no card data. Raw:`, result.raw || '(none)');
		ctx.lastTier2FailReason = 'AI could not parse card details from image';
		telemetry.outcome = 'miss';
		telemetry.latencyMs = Math.round(performance.now() - started);
		return null;
	}

	// Extract and clean AI output
	const rawHero = result.card.hero_name;
	const isGarbageHero = !rawHero || rawHero.length < 2 || /^(n\/?a|null|none|play|bonus|hot\s*dog)/i.test(rawHero);
	const claudeHero = isGarbageHero ? (result.card.card_name || null) : rawHero;
	const claudeNumber = result.card.card_number;
	const claudePower = result.card.power ? Number(result.card.power) : null;
	const claudeAthlete: string | null = result.card.athlete_name || null;

	// Detected game: server annotates this based on gameHint or Claude's output.
	// Top-level `result.game_id` is the canonical source; fall back to the card
	// object's `game_id`, then the caller's hint, then 'boba'.
	const detectedGameId: string =
		result.game_id ||
		result.card.game_id ||
		ctx.gameHint ||
		'boba';

	// ── Parallel detection fields (Phase 2.5) ─────────────────
	// The scan endpoint maps classifier short codes (cf/ff/ocm/sf) to the
	// human-readable DB names before returning. We accept either `parallel`
	// (current) or `variant` (legacy field name) to stay tolerant during
	// the rolling rename.
	const claudeParallel: string | null =
		(typeof result.card.parallel === 'string' && result.card.parallel.length > 0)
			? result.card.parallel
			: (typeof result.card.variant === 'string' && result.card.variant.length > 0)
				? result.card.variant
				: null;
	const parallelConfidence: number | null =
		typeof result.card.parallel_confidence === 'number'
			? result.card.parallel_confidence
			: typeof result.card.variant_confidence === 'number'
				? result.card.variant_confidence
				: null;
	const firstEditionStampDetected: boolean =
		result.card.first_edition_stamp_detected === true;
	const collectorNumberConfidence: number | null =
		typeof result.card.collector_number_confidence === 'number'
			? result.card.collector_number_confidence
			: null;

	console.debug(
		`[scan:${ctx.traceId}:tier2] Claude identified: game=${detectedGameId}, card_number="${claudeNumber}", ` +
		`hero="${claudeHero}", power=${claudePower}, confidence=${result.card.confidence}, ` +
		`parallel=${claudeParallel}, parallel_conf=${parallelConfidence}, stamp=${firstEditionStampDetected}, ` +
		`cn_conf=${collectorNumberConfidence}`
	);

	// Cross-validate against local DB — scoped to the detected game so card
	// numbers that collide between games (e.g., numeric-only) hit the right index.
	// Pass claudeParallel for Wonders so the lookup resolves to the correct
	// parallel row instead of returning a random parallel-blind match (which
	// would shadow Haiku's correct parallel at the merge step below).
	const validated = crossValidateCardResult(
		{
			cardNumber: claudeNumber,
			heroName: claudeHero,
			power: claudePower,
			confidence: result.card.confidence || 0.9,
			parallel: detectedGameId === 'wonders' ? claudeParallel : null
		},
		ctx.traceId,
		detectedGameId
	);

	if (validated.card) {
		// Always prefer Claude's athlete_name reading — the vision model is more
		// reliable than seed data which may have incorrect hero→athlete mappings.
		// Also ensure the returned card carries the detected game_id so the
		// hash writeback lands on the correct game.
		const mergedCard: Card = claudeAthlete
			? { ...validated.card, athlete_name: claudeAthlete }
			: { ...validated.card };
		if (!mergedCard.game_id) mergedCard.game_id = detectedGameId;
		console.debug(
			`[scan:${ctx.traceId}:tier2] Validated: id=${mergedCard.id}, number=${mergedCard.card_number}, ` +
			`game=${mergedCard.game_id}, method=${validated.validationMethod}, confidence=${validated.confidence}`
		);
		if (validated.warnings.length > 0) {
			console.warn(`[scan:${ctx.traceId}:tier2] Validation warnings:`, validated.warnings);
		}
		// Resolve parallel for DB write. cards.parallel is the source of truth —
		// for BoBA it carries the rich parallel name (e.g. "Battlefoil") encoded
		// from the prefix; for Wonders it carries the per-printing parallel
		// (one of Paper / Classic Foil / Formless Foil / Orbital Color Match /
		// Stonefoil) post-migration-30. Fall back to Claude's literal output,
		// then 'Paper'.
		const resolvedParallel =
			mergedCard.parallel ||
			claudeParallel ||
			(detectedGameId === 'boba' ? 'Paper' : null) ||
			null;

		// ── Phase 1 Doc 1.1 — Tier 2 catalog validation gate ────────────
		// Re-run validateCatalogTriangulation against Haiku's claimed
		// (card_number, name, parallel) and the resolved candidate. When
		// they disagree AND Haiku is confident in the card_number it read,
		// abandon the match — this is the case where name-only fallback in
		// crossValidateCardResult picked the wrong printing of a real card.
		// When Haiku's CN confidence is low, leave the candidate alone:
		// the fuzzy/trigram match was probably correcting a misread.
		let tier2ValidationPassed: boolean | null = null;
		let tier2ValidationFailureReason: string | null = null;
		let tier2ValidationGated: boolean | null = null;

		const tier2GateOn = featureEnabled('phase1_tier2_validation_v1')();
		if (tier2GateOn && (detectedGameId === 'boba' || detectedGameId === 'wonders')) {
			const tier2Validation = validateCatalogTriangulation({
				game: detectedGameId,
				ocrCardNumber: claudeNumber || null,
				ocrName: claudeHero || null,
				// Wonders only — BoBA derives parallel from the prefix.
				ocrParallel: detectedGameId === 'wonders' ? (claudeParallel || null) : null,
				candidateCard: {
					id: mergedCard.id,
					game_id: mergedCard.game_id ?? detectedGameId,
					card_number: mergedCard.card_number ?? '',
					hero_name: mergedCard.hero_name ?? null,
					name: mergedCard.name ?? null,
					parallel: mergedCard.parallel ?? null,
					set_code: mergedCard.set_code ?? null
				}
			});

			if (tier2Validation.passed) {
				tier2ValidationPassed = true;
				tier2ValidationFailureReason = null;
				tier2ValidationGated = false;
			} else {
				tier2ValidationPassed = false;
				tier2ValidationFailureReason = tier2Validation.reason;
				const cnConf = collectorNumberConfidence ?? 0;
				const highCnConfidence = cnConf >= 0.8;
				tier2ValidationGated = highCnConfidence;

				if (highCnConfidence) {
					console.warn(
						`[scan:${ctx.traceId}:tier2] Validation gate FIRED. ` +
						`Haiku said number="${claudeNumber}" name="${claudeHero}" ` +
						`(cn_conf=${cnConf}) but candidate is "${mergedCard.card_number}" ` +
						`name="${mergedCard.name ?? mergedCard.hero_name}" — abandoning. ` +
						`reason=${tier2Validation.reason}`
					);
					ctx.lastTier2FailReason =
						`Tier 2 validation failed: ${tier2Validation.reason} ` +
						`(Haiku read "${claudeNumber}" but matched candidate is "${mergedCard.card_number}")`;
					ctx.tier2GateOutcome = {
						passed: false,
						reason: tier2Validation.reason,
						gated: true
					};
					// Surface gate context onto telemetry's rawResponse for forensics.
					(telemetry as unknown as Record<string, unknown>).tier2ValidationGate = {
						passed: false,
						reason: tier2Validation.reason,
						haiku_card_number: claudeNumber,
						haiku_card_name: claudeHero,
						haiku_cn_confidence: cnConf,
						candidate_card_number: mergedCard.card_number,
						candidate_name: mergedCard.name ?? mergedCard.hero_name,
						gated: true
					};
					telemetry.outcome = 'miss';
					telemetry.latencyMs = Math.round(performance.now() - started);
					// Negative-cache the unrecognized number so we don't re-pay for
					// the same Haiku call on the same card immediately. Writes to
					// both local IDB (fast lookup) and global Supabase
					// (cross-tab/cross-device dedup + catalog gap surfacing).
					if (claudeNumber) {
						try {
							const hash = await getImageWorker().computeDHash(bitmap);
							await idb.setHash({ phash: hash, card_id: `__unrecognized:${claudeNumber}`, confidence: 0 });
						} catch (err) {
							console.debug(`[scan:${ctx.traceId}:tier2] IDB negative cache write failed`, err);
						}
						// Global negative cache (best-effort, non-blocking)
						try {
							const { getSupabase } = await import('$lib/services/supabase');
							const client = getSupabase();
							if (client) {
								await client.rpc('record_unrecognized_card', {
									p_card_number: claudeNumber,
									p_game_id: detectedGameId,
									p_haiku_hero_name: claudeHero ?? null
								});
							}
						} catch (err) {
							console.debug(`[scan:${ctx.traceId}:tier2] global negative cache write failed`, err);
						}
					}
					return null;
				} else {
					console.debug(
						`[scan:${ctx.traceId}:tier2] Validation failed but cn_conf=${cnConf} ` +
						`< 0.8 — letting candidate through. reason=${tier2Validation.reason}`
					);
					(telemetry as unknown as Record<string, unknown>).tier2ValidationGate = {
						passed: false,
						reason: tier2Validation.reason,
						haiku_card_number: claudeNumber,
						haiku_card_name: claudeHero,
						haiku_cn_confidence: cnConf,
						candidate_card_number: mergedCard.card_number,
						candidate_name: mergedCard.name ?? mergedCard.hero_name,
						gated: false
					};
				}
			}
		}

		telemetry.claudeReturnedNameInCatalog = true;
		telemetry.outcome = 'hit';
		telemetry.latencyMs = Math.round(performance.now() - started);
		return {
			card_id: mergedCard.id,
			card: mergedCard,
			scan_method: 'claude',
			confidence: validated.confidence,
			processing_ms: 0,
			parallel: resolvedParallel,
			parallel_confidence: parallelConfidence,
			first_edition_stamp_detected: firstEditionStampDetected,
			collector_number_confidence: collectorNumberConfidence,
			game_id: mergedCard.game_id ?? null,
			validationMethod: validated.validationMethod,
			validationWarnings: validated.warnings,
			// Phase 1 Doc 1.1 — propagate Tier 2 validation outcome up
			// to the orchestrator so it can write the dedicated columns.
			tier2ValidationPassed,
			tier2ValidationFailureReason,
			tier2ValidationGated
		};
	}

	// No match — log diagnostic info and write negative cache
	const totalCards = getAllCards().length;
	const playCardCount = getAllCards().filter(c => c.hero_name === null && c.power === null).length;
	console.warn(`[scan:${ctx.traceId}:tier2] Claude identified card_number="${claudeNumber}" hero="${claudeHero}" but NO MATCH in local card database (${totalCards} total, ${playCardCount} play cards)`);
	ctx.lastTier2FailReason = playCardCount === 0
		? `AI identified "${claudeNumber}" (${claudeHero}) — play cards not loaded, please reload the app`
		: `AI identified "${claudeNumber}" (${claudeHero}) but card not found in database`;

	// Negative cache to prevent repeated Tier 2 calls for the same unrecognized
	// card. Writes to both local IDB (fast lookup) and global Supabase
	// (cross-tab/cross-device dedup + catalog gap surfacing).
	if (claudeNumber) {
		try {
			const hash = await getImageWorker().computeDHash(bitmap);
			await idb.setHash({ phash: hash, card_id: `__unrecognized:${claudeNumber}`, confidence: 0 });
		} catch (err) {
			console.debug(`[scan:${ctx.traceId}:tier2] Failed to write IDB negative cache entry:`, err);
		}
		// Global negative cache (best-effort, non-blocking)
		try {
			const { getSupabase } = await import('$lib/services/supabase');
			const client = getSupabase();
			if (client) {
				await client.rpc('record_unrecognized_card', {
					p_card_number: claudeNumber,
					p_game_id: detectedGameId,
					p_haiku_hero_name: claudeHero ?? null
				});
			}
		} catch (err) {
			console.debug(`[scan:${ctx.traceId}:tier2] Failed to write global negative cache entry:`, err);
		}
	}

	telemetry.claudeReturnedNameInCatalog = false;
	telemetry.outcome = 'miss';
	telemetry.latencyMs = Math.round(performance.now() - started);
	return null;
	} catch (err) {
		telemetry.outcome = 'error';
		telemetry.errorMessage = err instanceof Error ? err.message : String(err);
		telemetry.latencyMs = Math.round(performance.now() - started);
		throw err;
	} finally {
		const sid = await resolveScanId(scanIdPromise);
		if (sid) {
			try {
				await emitTier2Result(sid, telemetry);
			} catch (err) {
				console.debug(`[scan:${ctx.traceId}:tier2] emit failed:`, err);
			}
		}
	}
}

// ── Tier 1: canonical PaddleOCR + optional upload TTA ──────

export interface Tier1Telemetry {
	canonical: {
		perTask: CanonicalResult['perTask'];
		ocrStrategy: CanonicalResult['ocrStrategy'];
		/** Phase 1 Doc 1.0 — catalog cross-validation outcome from the
		 *  canonical Tier 1 attempt. Used by the orchestrator to populate
		 *  scans.catalog_validation_* even when Tier 2 rescues the scan. */
		validation: { passed: boolean; reason: string | null } | null;
	} | null;
	tta: {
		frames_processed: number;
		consensus_reached: boolean;
		parallel_code: string | null;
		parallel_rule_fired: string | null;
		per_frame_results: unknown[];
		augmentation_set_version: string;
	} | null;
	canonicalAttempts: Array<{
		game: 'boba' | 'wonders';
		hit: boolean;
		confidence: number;
		ocr_strategy: CanonicalResult['ocrStrategy'];
	}>;
}

export interface Tier1Outcome {
	/** A finalized scan result if Tier 1 hit. Null means "fall through to Tier 2". */
	result: ScanResult | null;
	telemetry: Tier1Telemetry;
}

export interface Tier1Inputs {
	workingBitmap: ImageBitmap;
	ctx: ScanContext;
	imageSource: File | Blob | ImageBitmap;
	traceId: string;
	startTime: number;
	gameHint: string;
	isAutoDetect: boolean;
	liveConsensusSnapshot: LiveOCRSnapshot | null;
	liveConsensusReached: boolean;
	cardDetectContext: Record<string, unknown> | null;
	confidenceFloor: number;
	/**
	 * Whether upload TTA voting should run after canonical fails to clear the
	 * floor. Only meaningful for File uploads. Owned by the orchestrator so
	 * recognition-tiers stays free of feature-flag imports.
	 */
	ttaEnabled: boolean;
	/**
	 * Capture source label persisted on the Tier 1 forensic row
	 * (extras.capture_source). 'camera_live' / 'camera_upload' / 'binder' etc.
	 * Sourced from the orchestrator so this module stays free of imageSource
	 * classification logic.
	 */
	captureSource: string;
	/**
	 * Resolves to the scan row id (or null when unauthenticated / openScanRow
	 * failed). Tier 1 telemetry persistence awaits this in a finally block —
	 * a null resolution silently skips the write.
	 */
	scanIdPromise: Promise<string | null>;
	/** Phase 1 — frame-fusion diagnostics from the Scanner shutter path. */
	fusionDiag?: import('./tier1-telemetry.types').Tier1FusionDiag | null;
	/** Phase 6 — lens correction diagnostics from upload-card-detector. */
	lensDiag?: import('./tier1-telemetry.types').Tier1LensDiag | null;
}

/**
 * Tier 1 canonical PaddleOCR + optional upload TTA voting. Lifted from the
 * orchestrator so recognition.ts stays small. Returns either a complete
 * ScanResult (tier1 hit) or null (fall through to Tier 2). Telemetry is
 * always returned so Tier 2 can attach canonical/TTA context to its own
 * decision_context.
 */
export async function runTier1(inputs: Tier1Inputs): Promise<Tier1Outcome> {
	const {
		workingBitmap,
		ctx,
		imageSource,
		traceId,
		startTime,
		gameHint,
		isAutoDetect,
		liveConsensusSnapshot,
		liveConsensusReached,
		cardDetectContext,
		confidenceFloor,
		ttaEnabled,
		captureSource,
		scanIdPromise,
		fusionDiag,
		lensDiag
	} = inputs;

	let canonicalTelemetry: Tier1Telemetry['canonical'] = null;
	let ttaTelemetry: Tier1Telemetry['tta'] = null;
	let canonicalAttempts: Tier1Telemetry['canonicalAttempts'] = [];

	// ── Tier 1 telemetry accumulators ──────────────────────────
	// Tracked across every exit path; consumed by the finally block to
	// build the single scan_tier_results row owed to this invocation.
	const tier1StartMs = performance.now();
	let canonicalRef: CanonicalResult | null = null;
	let pathTaken: Tier1PathTaken = 'canonical';
	let hit = false;
	let errored = false;
	let errorMessage: string | null = null;
	let winningCardId: string | null = null;
	let winningParallel: string | null = null;
	let winningConfidence: number | null = null;
	let winningCardNumber: string | null = null;
	let winningCardName: string | null = null;
	let notes: string | null = null;
	let outcome: Tier1Outcome = {
		result: null,
		telemetry: { canonical: null, tta: null, canonicalAttempts: [] }
	};

	try {
		// Phase 2 Doc 2.0 — pre-shutter consensus short-circuit. When live OCR
		// has reached STRONG consensus and Doc 1.0 validation passes against
		// the live values, skip canonical entirely. tryLiveShortCircuit returns
		// null on any guard failure → fall through to canonical unchanged.
		const shortCircuitEnabled = featureEnabled('phase2_short_circuit_v1')();
		if (shortCircuitEnabled) {
			try {
				const sc = await tryLiveShortCircuit({
					liveConsensusSnapshot,
					gameHint,
					isAutoDetect,
					cardDetectContext,
					traceId,
					startTime
				});
				if (sc) {
					pathTaken = 'short_circuit';
					hit = !!sc.result?.card_id;
					winningCardId = sc.result?.card_id ?? null;
					winningParallel = sc.result?.parallel ?? null;
					winningConfidence = sc.result?.confidence ?? null;
					winningCardNumber = sc.result?.card?.card_number ?? null;
					winningCardName = sc.result?.card?.name ?? sc.result?.card?.hero_name ?? null;
					notes = 'live short-circuit';
					outcome = sc;
					return outcome;
				}
			} catch (err) {
				// Defensive — short-circuit must never throw out of runTier1.
				// Log and fall through to canonical.
				console.debug('[tier1] short-circuit attempt threw, falling through', err);
			}
		}

		checkpoint(traceId, 'tier1_canonical:start', performance.now() - startTime);
		try {
			// Auto-detect runs Tier 1 against both games sequentially. Explicit
			// gameHint runs only that game. Per-game attempts are logged in
			// decision_context.canonical_attempts so we can measure the auto-detect
			// win distribution post-deploy.
			const gamesToTry: Array<'boba' | 'wonders'> = isAutoDetect
				? ['boba', 'wonders']
				: gameHint === 'wonders'
					? ['wonders']
					: ['boba'];

			let canonical!: CanonicalResult;
			let game: 'boba' | 'wonders' = gamesToTry[0];

			for (const candidateGame of gamesToTry) {
				const attempt = await runCanonicalTier1(workingBitmap, candidateGame);
				canonical = attempt;
				game = candidateGame;
				canonicalAttempts.push({
					game: candidateGame,
					hit: !!attempt.card,
					confidence: attempt.confidence,
					ocr_strategy: attempt.ocrStrategy
				});
				if (attempt.card) break;
			}

			canonicalRef = canonical;
			canonicalTelemetry = {
				perTask: canonical.perTask,
				ocrStrategy: canonical.ocrStrategy,
				validation: canonical.validation
			};

			const liveSnap = liveConsensusSnapshot;
			const live = liveSnap?.consensus ?? null;
			// Live consensus emits classifier short codes; canonical.parallel is
			// already the human-readable DB name. Map before comparing.
			const liveParallelName = live?.parallel?.value
				? toParallelName(live.parallel.value)
				: null;
			const liveAgreed = !!(
				live?.reachedThreshold &&
				live.cardNumber?.value === canonical.cardNumber &&
				live.name?.value === canonical.name &&
				(game === 'boba' || liveParallelName === canonical.parallel)
			);

			// Enriched checkpoint extras (Tier 1 telemetry instrumentation):
			// adds OCR signals and detection context so the historical
			// scan_pipeline_checkpoint stream stays useful even without the
			// fuller scan_tier_results row.
			checkpoint(traceId, 'tier1_canonical:done', performance.now() - startTime, {
				hit: !!canonical.card,
				confidence: canonical.confidence,
				live_reached: liveConsensusReached,
				live_agreed: liveAgreed,
				ocr_strategy: canonical.ocrStrategy,
				detected_card_number: canonical.cardNumber,
				detected_name: canonical.name,
				card_number_conf: canonical.perTask.cardNumber.confidence,
				name_conf: canonical.perTask.name.confidence,
				detection_method: (cardDetectContext?.method as string | undefined) ?? null,
				aspect_ratio: (cardDetectContext?.aspect_ratio as number | undefined) ?? null,
				candidates_returned: canonical.card ? 1 : 0
			});

			// Phase 1 Doc 1.0 — Catalog cross-validation gate enforcement.
			// When the gate ran AND failed, force fallback regardless of OCR
			// confidence. validation==null means flag was off → preserve legacy
			// behavior (accept on confidence alone).
			const validationGated =
				canonical.validation !== null && !canonical.validation.passed;
			if (canonical.card && canonical.confidence >= confidenceFloor && !validationGated) {
				const divergent: string[] = [];
				if (live) {
					if (live.cardNumber?.value !== canonical.cardNumber) divergent.push('card_number');
					if (live.name?.value !== canonical.name) divergent.push('name');
					if (game === 'wonders' && liveParallelName !== canonical.parallel) divergent.push('parallel');
				}
				const decisionCtx: Record<string, unknown> = {
					live_session: liveSnap,
					canonical_result: canonical.perTask,
					canonical_ocr_strategy: canonical.ocrStrategy,
					canonical_attempts: canonicalAttempts,
					winning_game: game,
					live_vs_canonical: {
						live_ran: !!live,
						agreed: liveAgreed,
						divergent_fields: live ? divergent : null
					},
					catalog_validation: canonical.validation, // Phase 1 Doc 1.0
					...(cardDetectContext ? { upload_card_rect: cardDetectContext } : {})
				};
				const tier1Result: ScanResult = {
					card_id: canonical.card.id,
					card: {
						id: canonical.card.id,
						game_id: canonical.card.game_id,
						card_number: canonical.card.card_number,
						hero_name: canonical.card.hero_name ?? undefined,
						name: canonical.card.name ?? canonical.card.hero_name ?? '',
						set_code: canonical.card.set_code ?? '',
						parallel: canonical.card.parallel ?? undefined
					} as unknown as Card,
					scan_method: 'local_ocr',
					confidence: canonical.confidence,
					processing_ms: Math.round(performance.now() - startTime),
					parallel: canonical.parallel,
					game_id: canonical.card.game_id,
					liveConsensusReached,
					liveVsCanonicalAgreed: liveAgreed,
					fallbackTierUsed: null,
					winningTier: 'tier1_local_ocr',
					decisionContext: decisionCtx,
					// Phase 1 Doc 1.0 — surface validation outcome for the dedicated
					// scans.catalog_validation_* columns. NULL when flag is off.
					catalogValidationPassed: canonical.validation?.passed ?? null,
					catalogValidationFailureReason: canonical.validation?.passed === false
						? (canonical.validation.reason ?? null)
						: null,
					// Phase 2 Doc 2.0 — flag canonical-path scans as the non-short-
					// circuit cohort. When the flag is off this stays false; when on
					// and short-circuit declined, this is the canonical-path arm.
					tier1ShortCircuited: false,
					// Phase 2 Doc 2.4 — region-OCR batching telemetry.
					ocrRegionBatchSize: canonical.ocrRegionBatchSize,
					ocrRegionTotalMs: canonical.ocrRegionTotalMs
				};
				pathTaken = 'canonical';
				hit = true;
				winningCardId = canonical.card.id;
				winningParallel = canonical.parallel;
				winningConfidence = canonical.confidence;
				winningCardNumber = canonical.card.card_number ?? null;
				winningCardName = canonical.card.name ?? canonical.card.hero_name ?? null;
				outcome = {
					result: tier1Result,
					telemetry: { canonical: canonicalTelemetry, tta: null, canonicalAttempts }
				};
				return outcome;
			}
			// Below confidence floor OR validation gate fired — fall through to
			// TTA (uploads only) or Tier 2 Haiku.
			ctx.lastTier2FailReason = validationGated && canonical.validation
				? `validation_${canonical.validation.reason}`
				: null;
			if (validationGated && canonical.validation) {
				notes = `validation_failed:${canonical.validation.reason}`;
			} else if (canonical.card && canonical.confidence < confidenceFloor) {
				notes = `below_floor:${canonical.confidence.toFixed(2)}_lt_${confidenceFloor}`;
			} else if (!canonical.card) {
				notes = 'no_canonical_card';
			}

			// ── Upload TTA voting (Session 2.1b) ────────────────
			const ttaEligible = imageSource instanceof File;
			if (ttaEligible && ttaEnabled) {
				checkpoint(traceId, 'upload_tta:start', performance.now() - startTime);
				try {
					const tta = await runUploadPipeline(workingBitmap, game);
					ttaTelemetry = {
						frames_processed: tta.framesProcessed,
						consensus_reached: tta.consensusReached,
						parallel_code: tta.parallelCode ?? null,
						parallel_rule_fired: tta.parallelRuleFired,
						per_frame_results: tta.perFrameResults,
						augmentation_set_version: tta.augmentationSetVersion
					};
					checkpoint(traceId, 'upload_tta:done', performance.now() - startTime, {
						hit: tta.consensusReached,
						frames: tta.framesProcessed,
						confidence: tta.confidence
					});

					if (tta.consensusReached && tta.card) {
						const ttaDecisionCtx: Record<string, unknown> = {
							canonical_result: canonical.perTask,
							canonical_ocr_strategy: canonical.ocrStrategy,
							canonical_attempts: canonicalAttempts,
							winning_game: game,
							upload_tta: ttaTelemetry,
							catalog_validation: canonical.validation, // Phase 1 Doc 1.0
							...(cardDetectContext ? { upload_card_rect: cardDetectContext } : {})
						};
						const ttaResult: ScanResult = {
							card_id: tta.card.id,
							card: {
								id: tta.card.id,
								game_id: tta.card.game_id,
								card_number: tta.card.card_number,
								hero_name: tta.card.hero_name ?? undefined,
								name: tta.card.name ?? tta.card.hero_name ?? '',
								set_code: tta.card.set_code ?? '',
								parallel: tta.card.parallel ?? undefined
							} as unknown as Card,
							scan_method: 'upload_tta',
							confidence: tta.confidence,
							processing_ms: Math.round(performance.now() - startTime),
							parallel: tta.parallel,
							game_id: tta.card.game_id,
							liveConsensusReached,
							liveVsCanonicalAgreed: null,
							fallbackTierUsed: null,
							winningTier: 'tier1_upload_tta',
							decisionContext: ttaDecisionCtx,
							// Phase 1 Doc 1.0 — preserve canonical validation outcome
							// even when TTA rescued the scan.
							catalogValidationPassed: canonical.validation?.passed ?? null,
							catalogValidationFailureReason: canonical.validation?.passed === false
								? (canonical.validation.reason ?? null)
								: null,
							// Phase 2 Doc 2.0 — TTA path is canonical-cohort.
							tier1ShortCircuited: false,
							// Phase 2 Doc 2.4 — region-OCR batching telemetry.
							ocrRegionBatchSize: canonical.ocrRegionBatchSize,
							ocrRegionTotalMs: canonical.ocrRegionTotalMs
						};
						pathTaken = 'canonical_tta';
						hit = true;
						winningCardId = tta.card.id;
						winningParallel = tta.parallel ?? null;
						winningConfidence = tta.confidence;
						winningCardNumber = tta.card.card_number ?? null;
						winningCardName = tta.card.name ?? tta.card.hero_name ?? null;
						notes = `tta_rescued_after:${notes ?? 'canonical_miss'}`;
						outcome = {
							result: ttaResult,
							telemetry: { canonical: canonicalTelemetry, tta: ttaTelemetry, canonicalAttempts }
						};
						return outcome;
					}
					// TTA couldn't converge either — fall through to Haiku.
				} catch (err) {
					checkpoint(traceId, 'upload_tta:threw', performance.now() - startTime, {
						error: err instanceof Error ? err.message : String(err)
					});
					console.warn('[scan] Upload TTA failed, falling through to Tier 2:', err);
				}
			}
		} catch (err) {
			errored = true;
			errorMessage = err instanceof Error ? err.message : String(err);
			checkpoint(traceId, 'tier1_canonical:threw', performance.now() - startTime, {
				error: errorMessage
			});
			console.warn('[scan] Tier 1 canonical failed, falling through to Tier 2:', err);
		}

		outcome = {
			result: null,
			telemetry: { canonical: canonicalTelemetry, tta: ttaTelemetry, canonicalAttempts }
		};
		return outcome;
	} finally {
		// Single owner of the tier1_paddle_ocr row for this scan. Always runs
		// (hit, miss, error, short-circuit). Fire-and-forget; never throws.
		const latencyMs = Math.round(performance.now() - tier1StartMs);
		try {
			const payload = buildTier1TelemetryPayload({
				captureSource,
				engineVersion: 'PP-OCRv4-2.5',
				latencyMs,
				errored,
				errorMessage,
				errorCode: null,
				skipReason: null,
				pathTaken,
				gameHint,
				confidenceFloor,
				canonical: canonicalRef,
				liveSnapshot: liveConsensusSnapshot,
				cardDetectContext,
				winningCardId,
				winningParallel,
				winningConfidence,
				winningCardNumber,
				winningCardName,
				hit,
				notes,
				fusionDiag: fusionDiag ?? null,
				lensDiag: lensDiag ?? null,
				visualFeatures: canonicalRef?.visualFeatures ?? null,
				catalogDiag: canonicalRef?.catalogDiag ?? null,
				templateDiag: canonicalRef?.templateDiag ?? null
			});
			void scanIdPromise
				.then((scanId) => {
					if (!scanId) return;
					return writeTier1Result({ scanId, payload });
				})
				.catch((err) => {
					console.debug('[tier1] writeTier1Result chain failed', err);
				});
		} catch (telErr) {
			// Telemetry assembly must never affect the scan flow.
			console.debug('[tier1] telemetry assembly threw', telErr);
		}
	}
}
