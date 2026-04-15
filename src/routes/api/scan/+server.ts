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
import { resolveGameConfig, isValidGameId } from '$lib/games/resolver';
import type { RequestHandler } from './$types';

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

	// ── Load game-specific prompt and tool ──────────────────
	let systemPrompt = BOBA_SYSTEM_PROMPT;
	let userPrompt = BOBA_USER_PROMPT;
	let cardIdTool: Anthropic.Messages.Tool = BOBA_CARD_ID_TOOL;

	if (gameIdParam && isValidGameId(gameIdParam)) {
		try {
			const gameConfig = await resolveGameConfig(gameIdParam);
			systemPrompt = gameConfig.claudeSystemPrompt;
			userPrompt = gameConfig.claudeUserPrompt;
			cardIdTool = gameConfig.cardIdTool;
		} catch {
			// Fall back to BoBA defaults if game config resolution fails
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

		// ── Validate card_number isn't actually the power value ──────
		// Power values are always multiples of 5 (55, 60, ... 200, 250).
		// Paper cards have sequential numeric card numbers (1, 2, ... 300+).
		// When card_number has no prefix, equals power, AND is a multiple of 5
		// in the power range, it's likely Claude copied the power value.
		// However, some paper cards DO have numbers that are multiples of 5
		// (e.g. card #130 with 130 power), so we only clear when variant is
		// NOT explicitly "paper" — if Claude identified it as paper, it likely
		// read the number correctly from the bottom-left corner.
		const rawCardNumber = String(cardData.card_number || '').trim();
		const parsedAsNumber = parseInt(rawCardNumber, 10);

		if (
			!rawCardNumber.includes('-') &&
			!isNaN(parsedAsNumber) &&
			cardData.power === parsedAsNumber &&
			cardData.variant !== 'paper'
		) {
			console.warn(
				`[api/scan] Suspected power-as-card-number: card_number="${rawCardNumber}" matches power=${cardData.power}. ` +
				`Clearing card_number to force hero-based fallback.`
			);
			cardData.card_number = null;
			cardData.confidence = Math.min((cardData.confidence as number) || 0.5, 0.6);
		}

		console.log(`[api/scan] Claude identified: card_number="${cardData.card_number}", hero="${cardData.hero_name}", confidence=${cardData.confidence}`);

		return json({ success: true, card: cardData, method: 'claude' });
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
