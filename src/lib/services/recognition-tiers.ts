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
import { recordTierResult as writerRecordTierResult } from './scan-writer';
import { runCanonicalTier1, type CanonicalResult } from './tier1-canonical';
import { runUploadPipeline } from './upload-pipeline';
import { toParallelName } from '$lib/data/wonders-parallels';
import { checkpoint } from './scan-checkpoint';
import type { LiveOCRSnapshot } from './live-ocr-coordinator';
import type { Card, ScanResult } from '$lib/types';

// ── Shared types ────────────────────────────────────────────

export interface ScanContext {
	traceId: string;
	lastTier2FailReason: string | null;
	cropRegion?: { x: number; y: number; width: number; height: number } | null;
	/** Game hint for scoping Claude prompts + Phase 2 canonical OCR. Defaults to 'boba'. */
	gameHint: string;
}

// ── Per-tier telemetry (Session 1.2-tier-miss-telemetry) ────

/** Telemetry accumulated by runTier2 (the Claude-Haiku fallback). */
export interface Tier2Telemetry {
	attempted: boolean;
	skipReason: string | null;
	imageBytesUploaded: number | null;
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

export async function runTier2(
	bitmap: ImageBitmap,
	ctx: ScanContext,
	telemetry: Tier2Telemetry = emptyTier2Telemetry(),
	scanIdPromise: Promise<string | null> = Promise.resolve(null)
): Promise<ScanResult | null> {
	const started = performance.now();
	ctx.lastTier2FailReason = null;
	telemetry.attempted = true;
	telemetry.llmModelRequested = 'claude-haiku-4-5-20251001';

	try {
	// Resize and send to API
	let response: Response;
	try {
		const imageBlob = await getImageWorker().resizeForUpload(bitmap, 1024);
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
	const validated = crossValidateCardResult(
		{ cardNumber: claudeNumber, heroName: claudeHero, power: claudePower, confidence: result.card.confidence || 0.9 },
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
		};
	}

	// No match — log diagnostic info and write negative cache
	const totalCards = getAllCards().length;
	const playCardCount = getAllCards().filter(c => c.hero_name === null && c.power === null).length;
	console.warn(`[scan:${ctx.traceId}:tier2] Claude identified card_number="${claudeNumber}" hero="${claudeHero}" but NO MATCH in local card database (${totalCards} total, ${playCardCount} play cards)`);
	ctx.lastTier2FailReason = playCardCount === 0
		? `AI identified "${claudeNumber}" (${claudeHero}) — play cards not loaded, please reload the app`
		: `AI identified "${claudeNumber}" (${claudeHero}) but card not found in database`;

	// Negative cache to prevent repeated Tier 2 calls for the same unrecognized card
	if (claudeNumber) {
		try {
			const hash = await getImageWorker().computeDHash(bitmap);
			await idb.setHash({ phash: hash, card_id: `__unrecognized:${claudeNumber}`, confidence: 0 });
		} catch (err) {
			console.debug(`[scan:${ctx.traceId}:tier2] Failed to write negative cache entry:`, err);
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
		ttaEnabled
	} = inputs;

	let canonicalTelemetry: Tier1Telemetry['canonical'] = null;
	let ttaTelemetry: Tier1Telemetry['tta'] = null;
	let canonicalAttempts: Tier1Telemetry['canonicalAttempts'] = [];

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

		canonicalTelemetry = {
			perTask: canonical.perTask,
			ocrStrategy: canonical.ocrStrategy
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

		checkpoint(traceId, 'tier1_canonical:done', performance.now() - startTime, {
			hit: !!canonical.card,
			confidence: canonical.confidence,
			live_reached: liveConsensusReached,
			live_agreed: liveAgreed
		});

		if (canonical.card && canonical.confidence >= confidenceFloor) {
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
				decisionContext: decisionCtx
			};
			return {
				result: tier1Result,
				telemetry: { canonical: canonicalTelemetry, tta: null, canonicalAttempts }
			};
		}
		// Below confidence floor — fall through to TTA (uploads only) or
		// Tier 2 Haiku.
		ctx.lastTier2FailReason = null;

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
						decisionContext: ttaDecisionCtx
					};
					return {
						result: ttaResult,
						telemetry: { canonical: canonicalTelemetry, tta: ttaTelemetry, canonicalAttempts }
					};
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
		checkpoint(traceId, 'tier1_canonical:threw', performance.now() - startTime, {
			error: err instanceof Error ? err.message : String(err)
		});
		console.warn('[scan] Tier 1 canonical failed, falling through to Tier 2:', err);
	}

	return {
		result: null,
		telemetry: { canonical: canonicalTelemetry, tta: ttaTelemetry, canonicalAttempts }
	};
}
