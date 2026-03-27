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
import type { RequestHandler } from './$types';

const { maxFileSize: MAX_FILE_SIZE, maxPixels: MAX_PIXELS, allowedImageTypes: ALLOWED_TYPES } = BOBA_SCAN_CONFIG;

// ── Structured output tool definition ──────────────────────────
const CARD_ID_TOOL: Anthropic.Messages.Tool = {
	name: 'identify_card',
	description: 'Identify a BoBA trading card from an image',
	input_schema: {
		type: 'object' as const,
		properties: {
			card_name: { type: 'string', description: 'Full card name as printed' },
			hero_name: { type: 'string', description: 'BoBA hero name' },
			athlete_name: { type: 'string', description: 'Real athlete name if known, or null' },
			set_code: { type: 'string', description: 'Set identifier, or null' },
			card_number: { type: 'string', description: 'PREFIX-NUMBER from BOTTOM-LEFT. Null if unreadable.' },
			power: { type: 'number', description: 'Large number from TOP-RIGHT corner, or null' },
			rarity: { type: 'string', enum: ['common', 'uncommon', 'rare', 'ultra_rare', 'legendary'] },
			variant: { type: 'string', enum: ['base', 'foil', 'battlefoil', 'paper', 'inspired_ink'] },
			parallel: { type: 'string', description: 'Specific parallel name if identifiable, or null' },
			weapon_type: { type: 'string', enum: ['Fire', 'Ice', 'Steel', 'Hex', 'Glow', 'Brawl', 'Gum', 'Super', 'Alt', 'Cyber'], description: 'Weapon type or null' },
			confidence: { type: 'number', description: '0.0 to 1.0' },
			flags: { type: 'array', items: { type: 'string' }, description: 'Issues: blurry, glare, partial, foil_reflection' }
		},
		required: ['card_name', 'hero_name', 'confidence', 'rarity', 'variant']
	}
};

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

	// ── Claude API call with structured output ──────────────
	console.log(`[api/scan] Sending to Claude: image ${(cleanBuffer.length / 1024).toFixed(1)}KB, user=${user?.id ?? 'anonymous'}`);
	try {
		const response = await getAnthropicClient().messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 512,
			system: `You are a BoBA (Bo Jackson Battle Arena) trading card identification expert.

CRITICAL INSTRUCTIONS FOR READING THE CARD:
1. CARD NUMBER: Look at the BOTTOM LEFT corner of the card. Read the EXACT text printed there. This is the card number (format: PREFIX-NUMBER like "AB-123", "HW-567", "GR-042"). Do NOT guess this from memory. Do NOT use the power value (top right number) as the card number.
2. HERO NAME: Read the large title text at the TOP LEFT of the card. This is the hero name.
3. POWER: Read the number in the TOP RIGHT corner. This is the power value.
4. PARALLEL/VARIANT: Look for any special text, treatment indicators, or visual cues that identify this as a parallel variant. Common BoBA parallels include: Inspired Ink Battlefoil, 80's Rad Battlefoil, Grandma's Linoleum Battlefoil, Blizzard Battlefoil, Color Battlefoil (Orange/Blue/Green/Pink), Bubblegum Battlefoil, Mixtape Battlefoil, Miami Ice Battlefoil, Fire Tracks Battlefoil. Also look for foil/holo treatments, special borders, or alternate art indicators.

If a field is unclear, return null rather than guessing. It is MUCH better to return null for card_number than to fabricate one you are not certain about.`,
			tools: [CARD_ID_TOOL],
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
						text: `<task>Identify this BoBA trading card. Read EACH field independently from its physical location on the card.</task>

<critical_rules>
- CARD NUMBER: Read the EXACT text from the BOTTOM-LEFT corner box. Format is PREFIX-NUMBER.
- POWER: Read the LARGE number from the TOP-RIGHT corner. NEVER use it as card_number.
- HERO NAME: Read the large title text from the TOP-LEFT area.
- If card_number text is obscured, blurry, or you are uncertain, set card_number to null.
- Do NOT confabulate a card number from memory — only report what you can physically read.
</critical_rules>

<known_prefixes>BF, BFA, BBFA, BBF, BLBF, ABF, CBF, GBF, OBF, PBF, SBF, HBF, IBF, RBF, BGBF, RHBF, OHBF, MBFA, GLBF, PL, BPL, HTD, RAD, MIX, MI, BL, GGL, LOGO, FT, SF, SL, CHILL, ALT, CJ, PG, HD</known_prefixes>

<weapons>Fire=red, Ice=blue, Steel=gray, Hex=purple, Glow=yellow-green, Brawl=orange, Gum=pink, Super=gold 1/1, Alt=purple alternate art, Cyber=cyan/teal digital circuit</weapons>

<examples>
card_number="BF-108", hero_name="BoJax", power=200, weapon_type="Super"
card_number="PL-46", hero_name=null (Play card), power=null
card_number=null (unreadable), hero_name="The Kid", power=180, flags=["foil_reflection"]
</examples>`
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
		const KNOWN_POWER_VALUES = new Set([
			55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120,
			125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175, 180,
			185, 190, 195, 200, 250
		]);

		const rawCardNumber = String(cardData.card_number || '').trim();
		const parsedAsNumber = parseInt(rawCardNumber, 10);

		if (
			!rawCardNumber.includes('-') &&
			!isNaN(parsedAsNumber) &&
			KNOWN_POWER_VALUES.has(parsedAsNumber) &&
			cardData.power === parsedAsNumber
		) {
			console.warn(
				`[api/scan] Suspected power-as-card-number: card_number="${rawCardNumber}" matches power=${cardData.power}. ` +
				`Clearing card_number to force hero-based fallback.`
			);
			cardData.card_number = null;
			cardData.confidence = Math.min((cardData.confidence as number) || 0.5, 0.6);
		}

		console.log(`[api/scan] Claude identified: card_number="${cardData.card_number}", hero="${cardData.hero_name}", confidence=${cardData.confidence}`);

		// Track scan in database (only for authenticated users)
		if (user && locals.supabase) {
			try {
				await locals.supabase.from('scans').insert({
					user_id: user.id,
					scan_method: 'claude',
					confidence: (cardData.confidence as number) || null,
					processing_ms: null
				});
			} catch (err) {
				console.debug('[api/scan] Scan log insert failed:', err);
			}
		}

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
