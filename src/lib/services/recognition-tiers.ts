/**
 * Recognition Pipeline — Tier Functions
 *
 * Tier 3: Claude API → cross-validation against local DB
 *
 * Session 2.5 retired the legacy Tier 1 (pHash hash-cache lookup) and
 * Tier 2 (Tesseract OCR) paths. Phase 2 canonical local OCR now owns
 * Tier 1; Tier 3 stays as the Claude-Haiku fallback.
 *
 * runTier3 returns ScanResult | null. Null means "no match".
 */

import { idb } from './idb';
import { getAllCards } from './card-db';
import { getImageWorker } from './recognition-workers';
import { crossValidateCardResult } from './recognition-validation';
import { recordTierResult as writerRecordTierResult } from './scan-writer';
import type { Card, ScanResult } from '$lib/types';

// ── Shared types ────────────────────────────────────────────

export interface ScanContext {
	traceId: string;
	lastTier3FailReason: string | null;
	cropRegion?: { x: number; y: number; width: number; height: number } | null;
	/** Game hint for scoping Claude prompts + Phase 2 canonical OCR. Defaults to 'boba'. */
	gameHint: string;
}

// ── Per-tier telemetry (Session 1.2-tier-miss-telemetry) ────

/** Telemetry accumulated by runTier3. */
export interface Tier3Telemetry {
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

export function emptyTier3Telemetry(): Tier3Telemetry {
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

export async function emitTier3Result(scanId: string, t: Tier3Telemetry): Promise<void> {
	// Cost calc for Haiku 4.5 — duplicates the per-row sum done in
	// recognition.ts's finalize(). Fold into a shared helper when the
	// AI Gateway lands and replaces this hand-rolled pricing table.
	const costUsd =
		t.llmInputTokens !== null && t.llmOutputTokens !== null
			? (t.llmInputTokens * 1.0 + t.llmOutputTokens * 5.0) / 1_000_000
			: null;

	await writerRecordTierResult({
		scanId,
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

// ── Tier 3: Claude API ──────────────────────────────────────

export async function runTier3(
	bitmap: ImageBitmap,
	ctx: ScanContext,
	telemetry: Tier3Telemetry = emptyTier3Telemetry(),
	scanIdPromise: Promise<string | null> = Promise.resolve(null)
): Promise<ScanResult | null> {
	const started = performance.now();
	ctx.lastTier3FailReason = null;
	telemetry.attempted = true;
	telemetry.llmModelRequested = 'claude-haiku-4-5-20251001';

	try {
	// Resize and send to API
	let response: Response;
	try {
		const imageBlob = await getImageWorker().resizeForUpload(bitmap, 1024);
		telemetry.imageBytesUploaded = imageBlob.size;
		console.debug(`[scan:${ctx.traceId}:tier3] Image resized for upload: ${(imageBlob.size / 1024).toFixed(1)}KB`);
		const formData = new FormData();
		formData.append('image', imageBlob, 'scan.jpg');
		if (ctx.gameHint) {
			formData.append('game_id', ctx.gameHint);
		}
		response = await fetch('/api/scan', { method: 'POST', body: formData });
		telemetry.httpStatus = response.status;
	} catch (err) {
		console.error(`[scan:${ctx.traceId}:tier3] Network error calling /api/scan:`, err);
		ctx.lastTier3FailReason = 'Network error reaching scan API';
		telemetry.outcome = 'error';
		telemetry.errorMessage = err instanceof Error ? err.message : String(err);
		telemetry.latencyMs = Math.round(performance.now() - started);
		return null;
	}

	// Handle non-OK responses
	if (!response.ok) {
		let errorBody = '';
		try { errorBody = await response.text(); } catch { /* ignore */ }
		console.error(`[scan:${ctx.traceId}:tier3] API returned ${response.status}: ${errorBody}`);
		if (response.status === 401) ctx.lastTier3FailReason = 'Not authenticated — please sign in';
		else if (response.status === 429) ctx.lastTier3FailReason = 'Rate limited — please wait before scanning again';
		else if (response.status === 503) ctx.lastTier3FailReason = 'AI service overloaded — try again in a moment';
		else ctx.lastTier3FailReason = `Scan API error (${response.status})`;
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
		console.debug(`[scan:${ctx.traceId}:tier3] API response JSON parse failed:`, err);
		console.error(`[scan:${ctx.traceId}:tier3] Invalid JSON in API response`);
		ctx.lastTier3FailReason = 'Invalid response from scan API';
		telemetry.outcome = 'error';
		telemetry.parseSuccess = false;
		telemetry.errorMessage = 'JSON parse failed';
		telemetry.latencyMs = Math.round(performance.now() - started);
		return null;
	}

	// Capture raw response + Anthropic meta regardless of success/failure so
	// diagnostics have the full picture for every Tier 3 run.
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

	console.debug(`[scan:${ctx.traceId}:tier3] API response:`, JSON.stringify(result, null, 2));

	if (!result.success || !result.card) {
		console.warn(`[scan:${ctx.traceId}:tier3] API returned success=false or no card data. Raw:`, result.raw || '(none)');
		ctx.lastTier3FailReason = 'AI could not parse card details from image';
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
		`[scan:${ctx.traceId}:tier3] Claude identified: game=${detectedGameId}, card_number="${claudeNumber}", ` +
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
			`[scan:${ctx.traceId}:tier3] Validated: id=${mergedCard.id}, number=${mergedCard.card_number}, ` +
			`game=${mergedCard.game_id}, method=${validated.validationMethod}, confidence=${validated.confidence}`
		);
		if (validated.warnings.length > 0) {
			console.warn(`[scan:${ctx.traceId}:tier3] Validation warnings:`, validated.warnings);
		}
		// Resolve parallel for DB write. cards.parallel is the source of truth —
		// for BoBA it carries the rich parallel name (e.g. "Battlefoil") encoded
		// from the prefix; for Wonders it'll be 'Paper' until the foil catalog
		// expansion. Fall back to Claude's literal output, then 'Paper'.
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
	console.warn(`[scan:${ctx.traceId}:tier3] Claude identified card_number="${claudeNumber}" hero="${claudeHero}" but NO MATCH in local card database (${totalCards} total, ${playCardCount} play cards)`);
	ctx.lastTier3FailReason = playCardCount === 0
		? `AI identified "${claudeNumber}" (${claudeHero}) — play cards not loaded, please reload the app`
		: `AI identified "${claudeNumber}" (${claudeHero}) but card not found in database`;

	// Negative cache to prevent repeated Tier 3 calls for the same unrecognized card
	if (claudeNumber) {
		try {
			const hash = await getImageWorker().computeDHash(bitmap);
			await idb.setHash({ phash: hash, card_id: `__unrecognized:${claudeNumber}`, confidence: 0 });
		} catch (err) {
			console.debug(`[scan:${ctx.traceId}:tier3] Failed to write negative cache entry:`, err);
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
				await emitTier3Result(sid, telemetry);
			} catch (err) {
				console.debug(`[scan:${ctx.traceId}:tier3] emit failed:`, err);
			}
		}
	}
}
