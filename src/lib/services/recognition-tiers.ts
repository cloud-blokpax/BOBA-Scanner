/**
 * Recognition Pipeline — Tier Functions
 *
 * Tier 1: Perceptual hash lookup (IDB → Supabase exact → Supabase fuzzy)
 * Tier 2: OCR (Tesseract.js) → card number extraction → fuzzy match
 * Tier 3: Claude API → cross-validation against local DB
 *
 * Each tier returns ScanResult | null. Null means "no match, try next tier."
 */

import { idb } from './idb';
import { findCard, getCardById, getAllCards } from './card-db';
import { getSupabase } from './supabase';
import { getImageWorker } from './recognition-workers';
import { crossValidateCardResult } from './recognition-validation';
import { recognizeText } from '$lib/services/ocr';
import { extractCardNumber } from '$lib/utils/extract-card-number';
import { checkCorrection } from '$lib/services/scan-learning';
import { BOBA_OCR_REGIONS, BOBA_SCAN_CONFIG } from '$lib/data/boba-config';
import { resolveGameConfig, getAllGameConfigs } from '$lib/games/resolver';
import { recordTierResult as writerRecordTierResult } from './scan-writer';
import type { GameConfig } from '$lib/games/types';
import type { Card, ScanResult, ScanMethod, HashCacheEntry } from '$lib/types';

// ── Shared types ────────────────────────────────────────────

export interface ScanContext {
	traceId: string;
	lastOcrReading: string | null;
	lastTier3FailReason: string | null;
	cropRegion?: { x: number; y: number; width: number; height: number } | null;
	/** Game hint for scoping hash lookups, OCR extraction, and Claude prompts. Defaults to 'boba'. */
	gameHint: string;
}

// ── Per-tier telemetry (Session 1.2-tier-miss-telemetry) ────

/**
 * Telemetry accumulated by runTier1 at each branch. The caller creates
 * this object and passes it in; runTier1 mutates it in place. Emitted as
 * one scan_tier_results row regardless of hit/miss/error.
 */
export interface Tier1Telemetry {
	queryDhash: string | null;
	queryPhash256: string | null;
	idbCacheHit: boolean;
	sbExactHit: boolean;
	sbFuzzyHit: boolean;
	winnerDhashDistance: number | null;
	winnerPhashDistance: number | null;
	runnerUpMarginDhash: number | null;
	hashMatchCount: number | null;
	topnCandidates: Array<{ card_id: string; distance: number; rank: number }> | null;
	outcome: 'hit' | 'miss' | 'error';
	errorMessage: string | null;
	latencyMs: number;
}

/** Telemetry accumulated by runTier2. */
export interface Tier2Telemetry {
	attempted: boolean;
	skipReason: string | null;
	ocrTextRaw: string | null;
	ocrMeanConfidence: number | null;
	ocrWordCount: number | null;
	ocrDetectedCardNumber: string | null;
	regionsAttempted: number;
	regionsSucceeded: number;
	outcome: 'hit' | 'miss' | 'skipped' | 'error';
	errorMessage: string | null;
	latencyMs: number;
}

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

export function emptyTier1Telemetry(): Tier1Telemetry {
	return {
		queryDhash: null,
		queryPhash256: null,
		idbCacheHit: false,
		sbExactHit: false,
		sbFuzzyHit: false,
		winnerDhashDistance: null,
		winnerPhashDistance: null,
		runnerUpMarginDhash: null,
		hashMatchCount: null,
		topnCandidates: null,
		outcome: 'miss',
		errorMessage: null,
		latencyMs: 0
	};
}

export function emptyTier2Telemetry(): Tier2Telemetry {
	return {
		attempted: false,
		skipReason: null,
		ocrTextRaw: null,
		ocrMeanConfidence: null,
		ocrWordCount: null,
		ocrDetectedCardNumber: null,
		regionsAttempted: 0,
		regionsSucceeded: 0,
		outcome: 'skipped',
		errorMessage: null,
		latencyMs: 0
	};
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

// ── Tier-result emit (Session 1.4-rect-pathA) ───────────────
//
// Each tier calls its own emit at the END of the run, against fully-populated
// telemetry. This replaces the previous outer-orchestrator emit which fired
// whenever the outer Promise.race resolved — including timeout-wins-race,
// when telemetry was still pristine and a row of nulls was written.

export async function emitTier1Result(scanId: string, t: Tier1Telemetry): Promise<void> {
	await writerRecordTierResult({
		scanId,
		tier: 'tier1_hash',
		engine: 'phash',
		engineVersion: 'phash-v1',
		rawOutput: {
			query_dhash: t.queryDhash,
			query_phash_256: t.queryPhash256,
			idb_cache_hit: t.idbCacheHit,
			sb_exact_hit: t.sbExactHit,
			sb_fuzzy_hit: t.sbFuzzyHit
		},
		queryDhash: t.queryDhash,
		queryPhash256: t.queryPhash256,
		latencyMs: t.latencyMs,
		errored: t.outcome === 'error',
		errorMessage: t.errorMessage,
		outcome: t.outcome,
		ranAt: new Date(),
		topnCandidates: t.topnCandidates as Array<Record<string, unknown>> | null,
		idbCacheHit: t.idbCacheHit,
		sbExactHit: t.sbExactHit,
		sbFuzzyHit: t.sbFuzzyHit,
		winnerDhashDistance: t.winnerDhashDistance,
		winnerPhashDistance: t.winnerPhashDistance,
		runnerUpMarginDhash: t.runnerUpMarginDhash,
		hashMatchCount: t.hashMatchCount
	});
}

export async function emitTier2Result(scanId: string, t: Tier2Telemetry): Promise<void> {
	await writerRecordTierResult({
		scanId,
		tier: 'tier2_ocr',
		engine: 'tesseract_v5',
		engineVersion: 'tesseract-5',
		rawOutput: {
			attempted: t.attempted,
			regions_attempted: t.regionsAttempted,
			regions_succeeded: t.regionsSucceeded
		},
		latencyMs: t.latencyMs,
		errored: t.outcome === 'error',
		errorMessage: t.errorMessage,
		outcome: t.outcome,
		skipReason: t.skipReason,
		ranAt: new Date(),
		ocrTextRaw: t.ocrTextRaw,
		ocrMeanConfidence: t.ocrMeanConfidence,
		ocrWordCount: t.ocrWordCount,
		ocrDetectedCardNumber: t.ocrDetectedCardNumber
	});
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

// ── Mutable state ───────────────────────────────────────────

/** Circuit breaker: disable fuzzy hash RPC for the session if it fails once */
let _fuzzyHashRpcDisabled = false;
export function isFuzzyHashRpcDisabled(): boolean { return _fuzzyHashRpcDisabled; }
export function disableFuzzyHashRpc(): void { _fuzzyHashRpcDisabled = true; }

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

/** Fetch a card by ID from Supabase (fallback when not in local cache). */
async function fetchCardById(cardId: string): Promise<Card | null> {
	const client = getSupabase();
	if (!client) return null;
	const { data } = await client.from('cards').select('*').eq('id', cardId).maybeSingle();
	if (!data || typeof (data as Record<string, unknown>).id !== 'string') return null;
	return data as Card;
}

// ── Tier 1 (embedding) — DINOv2 nearest-neighbor via pgvector ──
//
// Session 1.6 swap-in for pHash Tier 1. Uploads the viewfinder-cropped
// bitmap to /api/scan/embedding, receives a 768-d L2-normalized vector,
// and calls match_card_embedding to find the closest source-art embedding.
//
// Gated by the 'embedding_tier1' feature flag — admin-only until measured.
// pHash Tier 1 (runTier1 below) remains the default for everyone else.

const EMBEDDING_MIN_SIMILARITY = 0.25;
const EMBEDDING_TOP_K = 3;
const EMBEDDING_JPEG_QUALITY = 0.9;

export async function runTier1Embedding(
	bitmap: ImageBitmap,
	ctx: ScanContext,
	writeHashToAllLayers: (hash: string, cardId: string, confidence: number, bitmap?: ImageBitmap, gameId?: string) => Promise<void>,
	telemetry: Tier1Telemetry = emptyTier1Telemetry(),
	scanIdPromise: Promise<string | null> = Promise.resolve(null)
): Promise<ScanResult | null> {
	const started = performance.now();
	let emittedViaEmbedding = false;
	try {
		// 1. Bitmap → JPEG blob. OffscreenCanvas.convertToBlob keeps this off
		//    the main thread's paint path; falls back to HTMLCanvas only if
		//    Offscreen is unavailable (Safari < 16.4).
		let blob: Blob;
		try {
			if (typeof OffscreenCanvas !== 'undefined') {
				const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
				const bctx = canvas.getContext('2d');
				if (!bctx) throw new Error('no 2d ctx');
				bctx.drawImage(bitmap, 0, 0);
				blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: EMBEDDING_JPEG_QUALITY });
			} else {
				const canvas = document.createElement('canvas');
				canvas.width = bitmap.width;
				canvas.height = bitmap.height;
				const bctx = canvas.getContext('2d');
				if (!bctx) throw new Error('no 2d ctx');
				bctx.drawImage(bitmap, 0, 0);
				blob = await new Promise<Blob>((resolve, reject) =>
					canvas.toBlob(
						(b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
						'image/jpeg',
						EMBEDDING_JPEG_QUALITY
					)
				);
			}
		} catch (err) {
			telemetry.outcome = 'error';
			telemetry.errorMessage = `encode: ${err instanceof Error ? err.message : String(err)}`;
			telemetry.latencyMs = Math.round(performance.now() - started);
			return null;
		}

		// 2. Server-side embedding
		let embedding: number[] | null = null;
		try {
			const resp = await fetch('/api/scan/embedding', {
				method: 'POST',
				headers: { 'Content-Type': 'image/jpeg' },
				body: blob
			});
			if (!resp.ok) {
				telemetry.errorMessage = `endpoint_${resp.status}`;
				telemetry.outcome = resp.status >= 500 ? 'error' : 'miss';
				telemetry.latencyMs = Math.round(performance.now() - started);
				return null;
			}
			const body = (await resp.json()) as { embedding?: number[] };
			if (!Array.isArray(body.embedding) || body.embedding.length !== 768) {
				telemetry.outcome = 'error';
				telemetry.errorMessage = 'endpoint_bad_shape';
				telemetry.latencyMs = Math.round(performance.now() - started);
				return null;
			}
			embedding = body.embedding;
		} catch (err) {
			telemetry.outcome = 'error';
			telemetry.errorMessage = `endpoint: ${err instanceof Error ? err.message : String(err)}`;
			telemetry.latencyMs = Math.round(performance.now() - started);
			return null;
		}

		// 3. Nearest-neighbor via match_card_embedding RPC. Game-scoped so
		//    BoBA scans (no embeddings seeded) miss gracefully and fall
		//    through to Tier 2/3.
		const client = getSupabase();
		if (!client) {
			telemetry.outcome = 'miss';
			telemetry.errorMessage = 'supabase_unavailable';
			telemetry.latencyMs = Math.round(performance.now() - started);
			return null;
		}

		type MatchCandidate = {
			card_id: string;
			variant: string;
			similarity: number;
			source: string;
		};
		const untypedRpc = client.rpc as unknown as (
			fn: string,
			args: Record<string, unknown>
		) => Promise<{ data: MatchCandidate[] | null; error: { message: string } | null }>;

		const targetGameId = ctx.gameHint || 'wonders'; // embeddings currently seeded for Wonders only
		const { data: candidates, error: rpcErr } = await untypedRpc('match_card_embedding', {
			query_embedding: embedding,
			target_game_id: targetGameId,
			top_k: EMBEDDING_TOP_K,
			min_similarity: EMBEDDING_MIN_SIMILARITY
		});

		if (rpcErr) {
			telemetry.outcome = 'error';
			telemetry.errorMessage = `rpc: ${rpcErr.message}`;
			telemetry.latencyMs = Math.round(performance.now() - started);
			return null;
		}
		if (!candidates || candidates.length === 0) {
			telemetry.outcome = 'miss';
			telemetry.latencyMs = Math.round(performance.now() - started);
			return null;
		}

		telemetry.hashMatchCount = candidates.length;
		telemetry.topnCandidates = candidates.map((c, i) => ({
			card_id: c.card_id,
			distance: 1 - c.similarity,
			rank: i
		}));
		if (candidates.length >= 2) {
			telemetry.runnerUpMarginDhash = (1 - candidates[1].similarity) - (1 - candidates[0].similarity);
		}

		const best = candidates[0];
		const card = getCardById(best.card_id) || (await fetchCardById(best.card_id));
		if (!card) {
			telemetry.outcome = 'miss';
			telemetry.errorMessage = 'card_not_in_local_db';
			telemetry.latencyMs = Math.round(performance.now() - started);
			return null;
		}

		// Fold the embedding hit into the pHash cache too: on next scan of the
		// same card, Tier 1 pHash can short-circuit without hitting the
		// embedding endpoint (which costs an HF call). The dHash is a free
		// byproduct since we're about to need it for the hash cache writeback.
		try {
			const hash = await getImageWorker().computeDHash(bitmap);
			await writeHashToAllLayers(
				hash,
				best.card_id,
				Math.min(1, Math.max(0, best.similarity)),
				bitmap,
				card.game_id || targetGameId
			);
		} catch (err) {
			console.debug(`[scan:${ctx.traceId}:tier1-embed] writeback failed (non-fatal):`, err);
		}

		telemetry.outcome = 'hit';
		telemetry.latencyMs = Math.round(performance.now() - started);
		// Stash for the emit: write via a dedicated tier1_embedding row so the
		// tier1_hit_rate view can segment by engine.
		await emitTier1EmbeddingResult(await resolveScanId(scanIdPromise), telemetry, best);
		emittedViaEmbedding = true;

		return {
			card_id: card.id,
			card,
			scan_method: 'hash_cache' as ScanMethod,
			confidence: best.similarity,
			processing_ms: 0,
			variant: best.variant || 'paper',
			variant_confidence: best.variant && best.variant !== 'paper' ? 1.0 : null
		};
	} catch (err) {
		telemetry.outcome = 'error';
		telemetry.errorMessage = err instanceof Error ? err.message : String(err);
		telemetry.latencyMs = Math.round(performance.now() - started);
		throw err;
	} finally {
		if (!emittedViaEmbedding) {
			const sid = await resolveScanId(scanIdPromise);
			if (sid) {
				try {
					await emitTier1EmbeddingResult(sid, telemetry, null);
				} catch (err) {
					console.debug(`[scan:${ctx.traceId}:tier1-embed] emit failed:`, err);
				}
			}
		}
	}
}

async function emitTier1EmbeddingResult(
	scanId: string | null,
	t: Tier1Telemetry,
	best:
		| { card_id: string; variant: string; similarity: number; source: string }
		| null
): Promise<void> {
	if (!scanId) return;
	await writerRecordTierResult({
		scanId,
		tier: 'tier1_embedding',
		engine: 'dinov2_base',
		engineVersion: 'dinov2-base-v1',
		rawOutput: {
			top_match: best
				? {
						card_id: best.card_id,
						variant: best.variant,
						similarity: best.similarity,
						source: best.source
					}
				: null,
			hash_match_count: t.hashMatchCount,
			topn_candidates: t.topnCandidates
		},
		latencyMs: t.latencyMs,
		errored: t.outcome === 'error',
		errorMessage: t.errorMessage,
		outcome: t.outcome,
		ranAt: new Date(),
		topnCandidates: (t.topnCandidates as Array<Record<string, unknown>> | null) ?? null,
		hashMatchCount: t.hashMatchCount
	});
}

// ── Tier 1: Perceptual Hash Lookup ──────────────────────────

export async function runTier1(
	bitmap: ImageBitmap,
	ctx: ScanContext,
	writeHashToAllLayers: (hash: string, cardId: string, confidence: number, bitmap?: ImageBitmap, gameId?: string) => Promise<void>,
	telemetry: Tier1Telemetry = emptyTier1Telemetry(),
	scanIdPromise: Promise<string | null> = Promise.resolve(null)
): Promise<ScanResult | null> {
	const started = performance.now();
	const worker = getImageWorker();

	try {
		const hash = await worker.computeDHash(bitmap);
		telemetry.queryDhash = hash;

		// Layer 1: IndexedDB exact match (instant, free)
		type CachedHashEntry = Pick<HashCacheEntry, 'card_id' | 'confidence'> & { variant?: string | null };
		const idbEntry = await idb.getHash(hash) as CachedHashEntry | undefined;
		if (idbEntry) {
			telemetry.idbCacheHit = true;
			// Detect negative cache entries (card recognized but not in database)
			if (idbEntry.card_id.startsWith('__unrecognized:')) {
				const cardNum = idbEntry.card_id.replace('__unrecognized:', '');
				telemetry.outcome = 'miss';
				telemetry.latencyMs = Math.round(performance.now() - started);
				return {
					card_id: null, card: null, scan_method: 'hash_cache' as ScanMethod,
					confidence: 0, processing_ms: 0,
					failReason: `Card "${cardNum}" recognized but not yet in database`
				};
			}
			const card = getCardById(idbEntry.card_id) || await fetchCardById(idbEntry.card_id);
			if (card) {
				telemetry.winnerDhashDistance = 0;
				telemetry.outcome = 'hit';
				telemetry.latencyMs = Math.round(performance.now() - started);
				return {
					card_id: card.id,
					card,
					scan_method: 'hash_cache',
					confidence: idbEntry.confidence,
					processing_ms: 0,
					// Variant from the hash cache entry — the pipeline already recorded this
					// variant the first time the card was scanned. Defaults to 'paper'.
					variant: idbEntry.variant ?? 'paper',
					variant_confidence: idbEntry.variant ? 1.0 : null,
				};
			}
		}

		// Layer 2: Supabase exact match (origin, <100ms)
		const client = getSupabase();
		let supaEntry: (Pick<HashCacheEntry, 'card_id' | 'confidence'> & { variant?: string | null }) | null = null;
		if (client) {
			const { data } = await client
				.from('hash_cache').select('card_id, confidence, variant').eq('phash', hash).maybeSingle();
			supaEntry = data as (Pick<HashCacheEntry, 'card_id' | 'confidence'> & { variant?: string | null }) | null;
		}

		if (supaEntry) {
			const card = getCardById(supaEntry.card_id) || await fetchCardById(supaEntry.card_id);
			if (card) {
				await idb.setHash({
					phash: hash,
					card_id: supaEntry.card_id,
					confidence: supaEntry.confidence,
					variant: supaEntry.variant ?? 'paper',
				});
				telemetry.sbExactHit = true;
				telemetry.winnerDhashDistance = 0;
				telemetry.outcome = 'hit';
				telemetry.latencyMs = Math.round(performance.now() - started);
				return {
					card_id: card.id,
					card,
					scan_method: 'hash_cache' as const,
					confidence: supaEntry.confidence,
					processing_ms: 0,
					variant: supaEntry.variant ?? 'paper',
					variant_confidence: supaEntry.variant ? 1.0 : null,
				};
			}
		}

		// Layer 3: Supabase fuzzy pHash-256 via find_similar_phash_256.
		// pHash-256 (DCT-based) carries 256 bits of signal vs dHash's 64 —
		// more robust to residual variance from camera angle and lighting.
		// The RPC returns up to 5 candidates ordered by Hamming distance.
		//
		// Accept policy:
		//   - Tight match: distance < 30. Safe on its own.
		//   - Loose-but-distinct: distance < 40 AND runner-up margin ≥ 10.
		//     Tolerates marginal top matches when the field is clearly separated.
		// Calibrated against the measured ~58-bit different-card noise floor.
		if (client) {
			try {
				const phash256 = await worker.computePHash(bitmap, 16);
				telemetry.queryPhash256 = phash256;
				if (/^[0-9a-f]{64}$/.test(phash256)) {
					// `find_similar_phash_256` was applied to production via MCP but
					// isn't in the generated Supabase types yet. Cast via unknown to
					// bypass the stale typings until db:types is regenerated.
					type PHashCandidate = {
						card_id: string;
						distance: number;
						confidence: number | null;
						variant?: string | null;
						source?: string | null;
					};
					const untypedRpc = client.rpc as unknown as (
						fn: string,
						args: Record<string, unknown>
					) => Promise<{ data: PHashCandidate[] | null; error: { message: string } | null }>;
					const { data: candidates, error } = await untypedRpc('find_similar_phash_256', {
						query_phash_256: phash256,
						max_distance: 40,
						p_game_id: ctx.gameHint || null,
						p_limit: 5
					});
					if (error) {
						console.debug(`[scan:${ctx.traceId}:tier1] pHash-256 RPC error:`, error.message);
						telemetry.errorMessage = `phash_rpc: ${error.message}`;
					} else if (candidates && candidates.length > 0) {
						telemetry.hashMatchCount = candidates.length;
						telemetry.topnCandidates = candidates.slice(0, 5).map((c, i) => ({
							card_id: c.card_id,
							distance: c.distance,
							rank: i
						}));
						if (candidates.length >= 2) {
							telemetry.runnerUpMarginDhash =
								candidates[1].distance - candidates[0].distance;
						}

						const match = candidates[0];
						const tightMatch = match.distance < 30;
						const looseButDistinct =
							match.distance < 40 &&
							candidates.length >= 2 &&
							candidates[1].distance - match.distance >= 10;

						if (tightMatch || looseButDistinct) {
							const card =
								getCardById(match.card_id) || (await fetchCardById(match.card_id));
							if (card) {
								// Slightly lighter confidence decay than dHash — pHash distance
								// units carry more information per bit.
								const adjustedConfidence =
									(match.confidence ?? 1) * (1 - match.distance * 0.005);
								const matchVariant = match.variant ?? 'paper';
								console.debug(
									`[scan:${ctx.traceId}:tier1] pHash-256 match: distance=${match.distance}, ` +
										`runnerUp=${candidates[1]?.distance ?? 'n/a'}, card=${card.card_number}, variant=${matchVariant}`
								);
								await writeHashToAllLayers(
									hash,
									match.card_id,
									adjustedConfidence,
									bitmap,
									ctx.gameHint
								);
								telemetry.sbFuzzyHit = true;
								telemetry.winnerPhashDistance = match.distance;
								telemetry.outcome = 'hit';
								telemetry.latencyMs = Math.round(performance.now() - started);
								return {
									card_id: card.id,
									card,
									scan_method: 'hash_cache' as const,
									confidence: adjustedConfidence,
									processing_ms: 0,
									variant: matchVariant,
									variant_confidence: matchVariant !== 'paper' ? 1.0 : null
								};
							}
						}
					}
				}
			} catch (err) {
				console.debug(`[scan:${ctx.traceId}:tier1] pHash-256 lookup unavailable:`, err);
				telemetry.errorMessage =
					telemetry.errorMessage ?? (err instanceof Error ? err.message : String(err));
			}
		}

		// Layer 4: Supabase fuzzy dHash via Hamming distance (≤5 bits different).
		// Legacy fallback — retained so older dHash-only cache rows still match
		// when pHash-256 misses. Will be pruned once embedding Tier 1 is live.
		if (client && !_fuzzyHashRpcDisabled && /^[0-9a-f]{16}$/.test(hash)) {
			try {
				const { data: fuzzyMatch, error: fuzzyErr } = await client.rpc('find_similar_hash', {
					query_hash: hash, max_distance: 5, p_game_id: ctx.gameHint || null
				});
				if (fuzzyErr) {
					console.debug(`[scan:${ctx.traceId}:tier1] Fuzzy hash lookup RPC error:`, fuzzyErr.message);
					_fuzzyHashRpcDisabled = true;
					telemetry.errorMessage = `fuzzy_rpc: ${fuzzyErr.message}`;
				} else if (fuzzyMatch && fuzzyMatch.length > 0) {
					// Capture telemetry for ALL fuzzy candidates, regardless of whether
					// we ultimately accept the top one — this is the only way to see
					// why borderline cards miss.
					telemetry.hashMatchCount = fuzzyMatch.length;
					telemetry.topnCandidates = fuzzyMatch.slice(0, 5).map((m: { card_id: string; distance: number }, i: number) => ({
						card_id: m.card_id,
						distance: m.distance,
						rank: i
					}));
					if (fuzzyMatch.length >= 2) {
						telemetry.runnerUpMarginDhash = fuzzyMatch[1].distance - fuzzyMatch[0].distance;
					}

					const match = fuzzyMatch[0];

					// pHash verification: reduce false positives by comparing perceptual hashes
					let pHashVerified = true;
					if (match.phash_256) {
						try {
							const queryPHash = await worker.computePHash(bitmap, 16);
							telemetry.queryPhash256 = queryPHash;
							const pHashDist = await worker.hammingDistance(queryPHash, match.phash_256);
							telemetry.winnerPhashDistance = pHashDist;
							pHashVerified = pHashDist <= 20;
							if (!pHashVerified) {
								console.debug(`[scan:${ctx.traceId}:tier1] Fuzzy dHash match rejected by pHash verification (pHash distance=${pHashDist})`);
							}
						} catch (err) {
							console.debug(`[scan:${ctx.traceId}:tier1] pHash computation failed, trusting dHash:`, err);
							pHashVerified = true;
						}
					}

					if (pHashVerified) {
						const card = getCardById(match.card_id) || await fetchCardById(match.card_id);
						if (card) {
							const adjustedConfidence = match.confidence * (1 - match.distance * 0.015);
							// Preserve variant from the existing hash_cache row on fuzzy match.
							const matchVariant = (match as { variant?: string | null }).variant ?? 'paper';
							await writeHashToAllLayers(hash, match.card_id, adjustedConfidence, bitmap, ctx.gameHint);
							console.debug(`[scan:${ctx.traceId}:tier1] Fuzzy hash match: distance=${match.distance}, card=${card.card_number}, variant=${matchVariant}`);
							telemetry.sbFuzzyHit = true;
							telemetry.winnerDhashDistance = match.distance;
							telemetry.outcome = 'hit';
							telemetry.latencyMs = Math.round(performance.now() - started);
							return {
								card_id: card.id,
								card,
								scan_method: 'hash_cache' as const,
								confidence: adjustedConfidence,
								processing_ms: 0,
								variant: matchVariant,
								variant_confidence: matchVariant !== 'paper' ? 1.0 : null,
							};
						}
					}
				}
			} catch (err) {
				console.debug(`[scan:${ctx.traceId}:tier1] Fuzzy hash lookup unavailable:`, err);
				telemetry.errorMessage = err instanceof Error ? err.message : String(err);
			}
		}

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
				await emitTier1Result(sid, telemetry);
			} catch (err) {
				console.debug(`[scan:${ctx.traceId}:tier1] emit failed:`, err);
			}
		}
	}
}

// ── Tier 2: OCR + Fuzzy Match ───────────────────────────────

export async function runTier2(
	bitmap: ImageBitmap,
	ctx: ScanContext,
	telemetry: Tier2Telemetry = emptyTier2Telemetry(),
	scanIdPromise: Promise<string | null> = Promise.resolve(null)
): Promise<ScanResult | null> {
	const TIER2_BUDGET_MS = 12000;
	const tier2Start = performance.now();
	telemetry.attempted = true;

	// Resolve the games we'll try:
	//   - gameHint set → only that game
	//   - gameHint null/empty → all registered games (auto-detect)
	// The first game listed is BoBA (more common), so its regions/extractors
	// run first and short-circuit on match.
	let gameConfigs: readonly GameConfig[];
	try {
		if (ctx.gameHint) {
			gameConfigs = [await resolveGameConfig(ctx.gameHint)];
		} else {
			gameConfigs = await getAllGameConfigs();
		}
	} catch {
		gameConfigs = [];
	}

	// Deduplicate OCR regions by label — many games share region definitions,
	// and running identical regions twice wastes the 12s budget.
	const seenRegions = new Set<string>();
	type RegionTask = { region: import('$lib/games/types').OcrRegion; config: GameConfig };
	const tasks: RegionTask[] = [];
	for (const config of gameConfigs) {
		for (const region of config.ocrRegions) {
			const key = `${region.x}:${region.y}:${region.w}:${region.h}`;
			if (seenRegions.has(key)) continue;
			seenRegions.add(key);
			tasks.push({ region, config });
		}
	}

	// Fallback to BoBA defaults if no game configs resolved (unlikely but safe)
	if (tasks.length === 0) {
		for (const region of BOBA_OCR_REGIONS) {
			tasks.push({ region, config: null as unknown as GameConfig });
		}
	}

	// Telemetry aggregation across all regions run this scan.
	const ocrTextFragments: string[] = [];
	const ocrConfidences: number[] = [];
	let ocrWordCountTotal = 0;
	let lastDetectedCardNumber: string | null = null;

	try {
		for (const { region, config } of tasks) {
			const elapsed = performance.now() - tier2Start;
			const remaining = TIER2_BUDGET_MS - elapsed;
			if (remaining <= 1000) {
				console.debug(`[scan:${ctx.traceId}:tier2] Budget exhausted after ${elapsed.toFixed(0)}ms, skipping remaining regions`);
				break;
			}

			telemetry.regionsAttempted++;

			try {
				const processedBlob = await withTimeout(
					getImageWorker().preprocessForOCR(bitmap, region),
					Math.min(3000, remaining), 'OCR preprocess'
				);

				const ocrResult = await withTimeout(
					recognizeText(processedBlob),
					Math.min(8000, remaining - 3000), 'OCR recognition'
				);

				// Capture raw OCR output for EVERY region that produced text,
				// even sub-threshold ones — the diagnostic value is "what did
				// OCR actually see?" regardless of confidence gate.
				if (ocrResult.text && ocrResult.text.length > 0) {
					telemetry.regionsSucceeded++;
					ocrTextFragments.push(ocrResult.text);
					ocrConfidences.push(ocrResult.confidence);
					ocrWordCountTotal += ocrResult.words?.length ?? 0;
				}

				if (ocrResult.confidence < BOBA_SCAN_CONFIG.ocrConfidenceThreshold) continue;

				// When in auto-detect mode, try every game's extractor against the same
				// OCR text. Prefix sets are disjoint (BF vs A1/P/T/...), so at most one
				// extractor matches. Plain-numeric Wonders cards intentionally fall
				// through to Tier 3 to avoid false-matching BoBA numbers.
				const extractorsToTry: Array<(text: string) => string | null> = config
					? [config.extractCardNumber]
					: gameConfigs.length > 0
						? gameConfigs.map((c) => c.extractCardNumber)
						: [extractCardNumber];
				const gameIdsForExtractors: Array<string | null> = config
					? [config.id]
					: gameConfigs.length > 0
						? gameConfigs.map((c) => c.id)
						: [null];

				for (let i = 0; i < extractorsToTry.length; i++) {
					const extractFn = extractorsToTry[i];
					const gameId = gameIdsForExtractors[i];
					const resolvedNumber = extractFn(ocrResult.text);
					if (!resolvedNumber) continue;

					// Capture what the extractor pulled, even if the DB lookup misses —
					// this answers "OCR read the right number but Tier 2 still missed."
					lastDetectedCardNumber = resolvedNumber;
					ctx.lastOcrReading = resolvedNumber;

					// Check local learned correction first (instant, offline-capable)
					let correctedNumber = checkCorrection(resolvedNumber);
					if (!correctedNumber) {
						try {
							const { lookupCommunityCorrection } = await import('$lib/services/community-corrections');
							correctedNumber = await lookupCommunityCorrection(resolvedNumber);
						} catch (err) {
							console.debug(`[scan:${ctx.traceId}:tier2] Community correction lookup failed:`, err);
						}
					}

					const lookupNumber = correctedNumber || resolvedNumber;
					const card = findCard(lookupNumber, null, gameId || 'boba');
					if (card) {
						// Annotate the card with the game we matched under, so the
						// hash writeback and downstream UI know which game this is.
						const cardWithGame: Card = gameId
							? { ...card, game_id: card.game_id || gameId }
							: card;
						// Tier 2 cannot visually detect variant. For Wonders, leave variant null
						// so the confirmation UI forces the user to choose (silent-miss protection).
						// For BoBA, variant is baked into card_number → default to 'paper'.
						const resolvedGameId = cardWithGame.game_id || gameId || 'boba';
						const tier2Variant = resolvedGameId === 'boba' ? 'paper' : null;

						telemetry.ocrTextRaw = ocrTextFragments.join(' | ');
						telemetry.ocrMeanConfidence = ocrConfidences.length
							? ocrConfidences.reduce((a, b) => a + b, 0) / ocrConfidences.length / 100
							: null;
						telemetry.ocrWordCount = ocrWordCountTotal || null;
						telemetry.ocrDetectedCardNumber = lastDetectedCardNumber;
						telemetry.outcome = 'hit';
						telemetry.latencyMs = Math.round(performance.now() - tier2Start);
						return {
							card_id: card.id,
							card: cardWithGame,
							scan_method: 'tesseract' as ScanMethod,
							confidence: correctedNumber ? 0.95 : ocrResult.confidence / 100,
							processing_ms: 0,
							game_id: cardWithGame.game_id ?? null,
							variant: tier2Variant,
							variant_confidence: null, // null forces variant selector on Wonders
							collector_number_confidence: ocrResult.confidence / 100,
						};
					}
				}
			} catch (err) {
				console.warn('OCR region failed:', err);
			}
		}

		telemetry.ocrTextRaw = ocrTextFragments.length ? ocrTextFragments.join(' | ') : null;
		telemetry.ocrMeanConfidence = ocrConfidences.length
			? ocrConfidences.reduce((a, b) => a + b, 0) / ocrConfidences.length / 100
			: null;
		telemetry.ocrWordCount = ocrWordCountTotal || null;
		telemetry.ocrDetectedCardNumber = lastDetectedCardNumber;
		telemetry.outcome = 'miss';
		telemetry.latencyMs = Math.round(performance.now() - tier2Start);
		return null;
	} catch (err) {
		telemetry.outcome = 'error';
		telemetry.errorMessage = err instanceof Error ? err.message : String(err);
		telemetry.latencyMs = Math.round(performance.now() - tier2Start);
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

	// ── Variant detection fields (Phase 2.5) ──────────────────
	// Wonders: variant comes from the decision-tree field (paper|cf|ff|ocm|sf).
	// BoBA: variant is baked into card_number via prefixes, so always 'paper'.
	const claudeVariant: string | null =
		(typeof result.card.variant === 'string' && result.card.variant.length > 0)
			? result.card.variant
			: null;
	const variantConfidence: number | null =
		typeof result.card.variant_confidence === 'number' ? result.card.variant_confidence : null;
	const firstEditionStampDetected: boolean =
		result.card.first_edition_stamp_detected === true;
	const collectorNumberConfidence: number | null =
		typeof result.card.collector_number_confidence === 'number'
			? result.card.collector_number_confidence
			: null;

	console.debug(
		`[scan:${ctx.traceId}:tier3] Claude identified: game=${detectedGameId}, card_number="${claudeNumber}", ` +
		`hero="${claudeHero}", power=${claudePower}, confidence=${result.card.confidence}, ` +
		`variant=${claudeVariant}, variant_conf=${variantConfidence}, stamp=${firstEditionStampDetected}, ` +
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
		// Normalize variant: Wonders uses the new enum; BoBA always 'paper'.
		// The scan endpoint already writes variant on cardData, but we guard
		// here in case it's null (e.g., older API version or BoBA path).
		const resolvedVariant =
			claudeVariant ||
			(detectedGameId === 'boba' ? 'paper' : null) ||
			result.card.parallel ||
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
			variant: resolvedVariant,
			variant_confidence: variantConfidence,
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
