/**
 * POST /api/scan — Claude API proxy for card identification
 *
 * Only called by Tier 3 of the recognition pipeline.
 * Auth optional. Rate limited. Images sanitized via sharp CDR.
 * Uses structured output (tool use) for guaranteed valid JSON.
 */

import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { checkScanRateLimit, checkAnonScanRateLimit } from '$lib/server/rate-limit';
import { getAnthropicClient } from '$lib/server/anthropic';
import { BOBA_SCAN_CONFIG } from '$lib/data/boba-config';
import { BOBA_CARD_ID_TOOL, BOBA_SYSTEM_PROMPT, BOBA_USER_PROMPT } from '$lib/games/boba/prompt';
import {
	WONDERS_CARD_ID_TOOL,
	WONDERS_SYSTEM_PROMPT,
	WONDERS_USER_PROMPT
} from '$lib/games/wonders/prompt';
import {
	MULTI_GAME_CARD_ID_TOOL,
	MULTI_GAME_SYSTEM_PROMPT,
	MULTI_GAME_USER_PROMPT
} from '$lib/games/multi-game-prompt';
import { isValidGameId, getAllGameConfigs } from '$lib/games/resolver';
import { normalizeParallelForServer } from '$lib/data/wonders-parallels';
import type { RequestHandler } from './$types';

/**
 * Probe each registered game's card-number extractor against a candidate
 * number string. Returns the first game whose extractor accepts the format,
 * or 'boba' if none do. Used as a fallback when Claude omits the `game`
 * field during auto-detect.
 */
async function disambiguateGameFromCardNumber(candidate: unknown): Promise<string> {
	if (typeof candidate !== 'string' || !candidate.trim()) return 'boba';
	try {
		const configs = await getAllGameConfigs();
		// Prefer non-BoBA matches so a Wonders-shaped number isn't masked by
		// BoBA's permissive numeric-only fallback.
		const nonBoba = configs.filter((c) => c.id !== 'boba');
		for (const cfg of nonBoba) {
			if (cfg.extractCardNumber(candidate)) return cfg.id;
		}
		for (const cfg of configs) {
			if (cfg.id === 'boba' && cfg.extractCardNumber(candidate)) return 'boba';
		}
	} catch (err) {
		console.debug('[api/scan] Game disambiguation failed, defaulting to boba:', err);
	}
	return 'boba';
}

// Claude Haiku vision call + sharp CDR + rate limiting = 5-12s typical
export const config = { maxDuration: 60 };

const { maxFileSize: MAX_FILE_SIZE, maxPixels: MAX_PIXELS, allowedImageTypes: ALLOWED_TYPES } = BOBA_SCAN_CONFIG;

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	// ── Auth check (optional — anonymous users get stricter rate limits) ──
	const { user } = await locals.safeGetSession();

	// ── Rate limiting ───────────────────────────────────────
	const rateLimitKey = user?.id ?? getClientAddress();
	const rateLimit = user
		? await checkScanRateLimit(rateLimitKey)
		: await checkAnonScanRateLimit(rateLimitKey);
	if (!rateLimit.success) {
		return json(
			{ error: 'Rate limited. Please wait before scanning again.' },
			{
				status: 429,
				headers: {
					'X-RateLimit-Limit': String(rateLimit.limit),
					'X-RateLimit-Remaining': String(rateLimit.remaining),
					'X-RateLimit-Reset': String(rateLimit.reset)
				}
			}
		);
	}

	// ── Global anonymous scan cap (prevents IP rotation abuse) ──
	if (!user) {
		const { checkGlobalAnonScanLimit, isRedisAvailable } = await import('$lib/server/redis');

		// Circuit breaker: block anonymous scans when Redis is unavailable
		// to prevent unmetered Claude API usage
		if (!isRedisAvailable()) {
			return json(
				{ error: 'Service temporarily limited. Please sign in to scan.' },
				{ status: 503 }
			);
		}

		const globalAllowed = await checkGlobalAnonScanLimit();
		if (!globalAllowed) {
			return json(
				{ error: 'Daily scan limit reached. Please sign in for unlimited scans.' },
				{ status: 429 }
			);
		}
	}

	// ── Parse form data ─────────────────────────────────────
	const formData = await request.formData();
	const imageFile = formData.get('image');
	const gameIdParam = formData.get('game_id') as string | null;

	if (!imageFile || !(imageFile instanceof File)) {
		throw error(400, 'Image file required');
	}

	if (imageFile.size > MAX_FILE_SIZE) {
		throw error(400, 'Image too large (max 10MB)');
	}

	if (!(ALLOWED_TYPES as readonly string[]).includes(imageFile.type)) {
		throw error(400, 'Invalid image type. Allowed: JPEG, PNG, WebP');
	}

	// ── Content Disarm & Reconstruction ─────────────────────
	const rawBuffer = Buffer.from(await imageFile.arrayBuffer());

	let metadata;
	try {
		metadata = await sharp(rawBuffer).metadata();
	} catch (err) {
		console.debug('[api/scan] Image metadata read failed:', err);
		throw error(400, 'Invalid image file');
	}

	// Pixel bomb protection
	const pixels = (metadata.width || 0) * (metadata.height || 0);
	if (pixels > MAX_PIXELS) {
		throw error(400, `Image too large (${pixels} pixels, max ${MAX_PIXELS})`);
	}

	// Strip EXIF/GPS, re-encode clean JPEG
	const cleanBuffer = await sharp(rawBuffer)
		.rotate() // Apply EXIF rotation then strip metadata
		.resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
		.jpeg({ quality: 85 })
		.toBuffer();

	const base64 = cleanBuffer.toString('base64');

	// ── Load prompt and tool ─────────────────────────────────
	// - If gameIdParam is provided and valid → use that game's config
	// - Otherwise → use the multi-game auto-detect prompt, which asks
	//   Claude to first identify the game, then fill in fields for it.
	// Prompt dispatch: server-only. Intentionally NOT routed through
	// resolveGameConfig — prompts don't belong in client-reachable
	// GameConfig (they'd drag ~14KB of strings into every lazy chunk).
	let systemPrompt: string;
	let userPrompt: string;
	let cardIdTool: Anthropic.Messages.Tool;
	const isAutoDetect = !gameIdParam || !isValidGameId(gameIdParam);

	if (isAutoDetect) {
		systemPrompt = MULTI_GAME_SYSTEM_PROMPT;
		userPrompt = MULTI_GAME_USER_PROMPT;
		cardIdTool = MULTI_GAME_CARD_ID_TOOL;
	} else {
		switch (gameIdParam) {
			case 'wonders':
				systemPrompt = WONDERS_SYSTEM_PROMPT;
				userPrompt = WONDERS_USER_PROMPT;
				cardIdTool = WONDERS_CARD_ID_TOOL;
				break;
			case 'boba':
			default:
				systemPrompt = BOBA_SYSTEM_PROMPT;
				userPrompt = BOBA_USER_PROMPT;
				cardIdTool = BOBA_CARD_ID_TOOL;
				break;
		}
	}

	// ── Claude API call with structured output ──────────────
	console.log(`[api/scan] Sending to Claude: image ${(cleanBuffer.length / 1024).toFixed(1)}KB, user=${user?.id ?? 'anonymous'}, game=${gameIdParam || 'boba'}`);
	try {
		const response = await getAnthropicClient().messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 512,
			system: systemPrompt,
			tools: [cardIdTool],
			tool_choice: { type: 'tool' as const, name: 'identify_card' },
			messages: [{
				role: 'user',
				content: [
					{
						type: 'image',
						source: { type: 'base64', media_type: 'image/jpeg', data: base64 }
					},
					{
						type: 'text',
						text: userPrompt
					}
				]
			}]
		});

		// ── Extract structured tool-use result (guaranteed valid JSON) ──
		const toolUse = response.content.find(block => block.type === 'tool_use');
		if (!toolUse || toolUse.type !== 'tool_use') {
			console.warn('[api/scan] No tool_use block in Claude response');
			return json({ success: false, method: 'claude' }, { status: 502 });
		}

		const cardData = toolUse.input as Record<string, unknown>;

		// ── Determine which game the card belongs to ────────────
		// Priority: explicit gameIdParam > Claude's `game` field >
		//          extractor-based disambiguation on the returned number >
		//          default 'boba'.
		// The extractor fallback catches the case where auto-detect Claude
		// returns a Wonders-shaped collector number without the `game` field,
		// which would otherwise route the card to BoBA validation and fail.
		let detectedGameId: string;
		if (gameIdParam && isValidGameId(gameIdParam)) {
			detectedGameId = gameIdParam;
		} else if (typeof cardData.game === 'string' && isValidGameId(cardData.game)) {
			detectedGameId = cardData.game;
		} else {
			detectedGameId = await disambiguateGameFromCardNumber(
				cardData.card_number ?? cardData.collector_number
			);
		}

		// ── Normalize Wonders field aliases into the common shape ─
		// Tier 3 validation uses card_number/hero_name; Wonders emits
		// collector_number/card_name — merge them so downstream is uniform.
		if (detectedGameId === 'wonders') {
			if (!cardData.card_number && cardData.collector_number) {
				cardData.card_number = cardData.collector_number;
			}
			if (!cardData.hero_name && cardData.card_name) {
				cardData.hero_name = cardData.card_name;
			}
			// Wonders `power` is a string like "4" or "S" — convert numeric to number
			// so Tier 3's `Number(power)` stays stable.
			if (typeof cardData.power === 'string' && /^\d+$/.test(cardData.power)) {
				cardData.power = parseInt(cardData.power, 10);
			} else if (typeof cardData.power === 'string' && !/^\d+$/.test(cardData.power)) {
				// Non-numeric power (S/I/L) — clear so Tier 3 treats as null
				cardData.power = null;
			}
		}

		// ── Parallel field normalization (game-agnostic) ─────────
		// Older tool versions returned `variant` or `foil_treatment` instead of
		// `parallel`. Coerce to a single `parallel` field for both games.
		if (!cardData.parallel && cardData.variant) {
			cardData.parallel = cardData.variant;
		}
		if (!cardData.parallel && cardData.foil_treatment) {
			cardData.parallel = cardData.foil_treatment;
		}
		// Normalize Wonders parallel output from Claude. Handles short codes
		// (cf/ff/ocm/sf), snake_case aliases (classic_foil, stone_foil, etc.),
		// and passes BoBA values (battlefoil, rad, …) through unchanged.
		// Canonical mapping lives in $lib/data/wonders-parallels.
		if (typeof cardData.parallel === 'string') {
			cardData.parallel = normalizeParallelForServer(cardData.parallel);
		}

		// Annotate game_id on the payload so Tier 3 can route correctly.
		cardData.game_id = detectedGameId;

		// Doc 2.5 — power-as-card-number guard (BoBA only).
		// Doc 2.5 removes `power` from the BoBA Tier 2 schema (the catalog has it),
		// so the prior guard's `cardData.power === parsedAsNumber` test no longer
		// applies. New heuristic: when BoBA Tier 2 returns a plain numeric
		// card_number (no prefix), check the catalog for AT LEAST ONE row with
		// a prefix at that number suffix. If multiple parallel rows share the
		// numeric suffix and the user's card has a prefix we missed, force a
		// fallback. (Defensive — catches the BBF-82 → "82"-stripped-as-130
		// failure mode.)
		//
		// Specifically: a paper card with card_number="130" exists in the catalog
		// (Mustang, Dart-Board, Stitcher all sit at 130). A user holding a
		// BBF-82 card whose Tier 2 read "130" (because they read the power)
		// would land on Mustang/Dart-Board/Stitcher — wrong card. We can't
		// fully solve this without a second-pass image read, but we can lower
		// confidence on plain-numeric card_numbers when the same numeric also
		// matches the power-stat range (a known multiple-of-5 in 55–250).
		if (detectedGameId === 'boba') {
			const rawCardNumber = String(cardData.card_number || '').trim();
			const parsedAsNumber = parseInt(rawCardNumber, 10);
			const looksLikePowerValue =
				!rawCardNumber.includes('-') &&
				!isNaN(parsedAsNumber) &&
				parsedAsNumber >= 55 &&
				parsedAsNumber <= 250 &&
				parsedAsNumber % 5 === 0;

			if (looksLikePowerValue) {
				console.warn(
					`[api/scan] Suspected power-as-card-number: card_number="${rawCardNumber}" sits in the power-stat range. ` +
					`Lowering confidence so the lookup gates on Phase 1 catalog validation.`
				);
				// Do NOT clear card_number — it might be a real paper card #130.
				// Just lower confidence so Phase 1 Doc 1.0 catalog validation
				// gates more aggressively. If the (card_number, name) tuple
				// triangulates to a real catalog row, the gate passes; if not,
				// it forces Tier 3 escalation (or abandon).
				cardData.confidence = Math.min((cardData.confidence as number) || 0.5, 0.6);
			}
		}

		console.log(`[api/scan] Claude identified: game=${detectedGameId}, card_number="${cardData.card_number}", hero="${cardData.hero_name}", confidence=${cardData.confidence}`);

		// Surface Anthropic usage/model metadata so Tier 3 telemetry can record
		// tokens, finish reason, responded model, and request ID. All fields are
		// defensively guarded — unknown fields on future SDK versions won't throw.
		const usage = response.usage as {
			input_tokens?: number;
			output_tokens?: number;
			cache_creation_input_tokens?: number | null;
			cache_read_input_tokens?: number | null;
		} | undefined;
		const meta = {
			model: response.model ?? null,
			input_tokens: usage?.input_tokens ?? null,
			output_tokens: usage?.output_tokens ?? null,
			cache_creation_tokens: usage?.cache_creation_input_tokens ?? null,
			cache_read_tokens: usage?.cache_read_input_tokens ?? null,
			finish_reason: response.stop_reason ?? null,
			anthropic_request_id: response.id ?? null,
			image_bytes: cleanBuffer.length
		};

		return json({ success: true, card: cardData, method: 'claude', game_id: detectedGameId, meta });
	} catch (err) {
		console.error('[api/scan] Claude API error:', err);

		if (err instanceof Anthropic.APIError) {
			if (err.status === 529) {
				throw error(503, 'AI service temporarily overloaded. Please retry.');
			}
			throw error(502, 'AI service error');
		}

		throw error(500, 'Internal server error');
	}
};
