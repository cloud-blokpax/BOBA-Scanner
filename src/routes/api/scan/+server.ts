/**
 * POST /api/scan — Claude API proxy for card identification
 *
 * Only called by Tier 3 of the recognition pipeline.
 * Auth required. Rate limited. Images sanitized via sharp CDR.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { checkScanRateLimit, checkAnonScanRateLimit } from '$lib/server/rate-limit';
import { BOBA_SCAN_CONFIG } from '$lib/data/boba-config';
import type { RequestHandler } from './$types';

const { maxFileSize: MAX_FILE_SIZE, maxPixels: MAX_PIXELS, allowedImageTypes: ALLOWED_TYPES } = BOBA_SCAN_CONFIG;

let _anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
	const apiKey = env.CLAUDE_API_KEY ?? env.ANTHROPIC_API_KEY ?? '';
	if (!apiKey) {
		throw new Error('Anthropic API key not configured');
	}
	if (!_anthropic) {
		_anthropic = new Anthropic({ apiKey });
	}
	return _anthropic;
}

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
		const { checkGlobalAnonScanLimit } = await import('$lib/server/redis');
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

	// ── Claude API call ─────────────────────────────────────
	console.log(`[api/scan] Sending to Claude: image ${(cleanBuffer.length / 1024).toFixed(1)}KB, user=${user?.id ?? 'anonymous'}`);
	try {
		const response = await getAnthropicClient().messages.create({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 256,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image',
							source: { type: 'base64', media_type: 'image/jpeg', data: base64 }
						},
						{
							type: 'text',
							text: `Identify this Bo Jackson Battle Arena (BoBA) trading card.

CRITICAL — POWER vs CARD NUMBER:
- The POWER value is the LARGE number in the TOP-RIGHT corner, often with "POWER" written vertically beside it. Common values: 60, 80, 100, 120, 140, 160, 180, 200. This is NOT the card number. NEVER return the power value as the card_number.
- The CARD NUMBER is SMALL text in the BOTTOM-LEFT corner, inside a small colored box. It almost always has a letter prefix followed by a dash and digits.

CARD NUMBER PREFIXES (most common):
BF, BFA, BBFA, BBF, BLBF, ABF, CBF, GBF, OBF, PBF, SBF, HBF, IBF, RBF, BGBF, RHBF, OHBF, MBFA, GLBF, PL, BPL, HTD, RAD, MIX, MI, BL, GGL, LOGO, FT, SF, SL, CHILL, ALT, CJ, PG, HD

Example card numbers: BF-108, BFA-5, BLBF-84, PL-46, BBF-56, BPL-7, RAD-42, GLBF-100, HTD-15
Some older cards use plain numbers (35, 76, 155) but these are ALWAYS small text in the bottom-left — never the large power number.

CARD LAYOUT GUIDE:
- Hero name: Large text at the top of the card
- Power value: Large number in TOP-RIGHT (DO NOT use this as card_number)
- Card number: Small text in BOTTOM-LEFT box (use the prefix-dash-number format above)
- Set identifier: Text on the card border or bottom area
- Serial number: Sometimes shown as "X/Y" (e.g., "1/10") — this is NOT the card number either

WEAPON TYPE (by icon color at bottom-right):
Fire (red), Ice (blue), Steel (gray), Hex (purple), Glow (yellow-green), Brawl (orange), Gum (pink), Super (gold-on-black 1/1)

PARALLEL/TREATMENT:
Base Paper (matte), Battlefoil (holographic foil — Silver, Blue, Orange, Green, Pink, Red), Named Inserts (Blizzard, 80s Rad, Headlines, Sepia, Neon, etc.), Inspired Ink (on-card autograph with signature visible)

Return ONLY valid JSON:
{
  "card_name": "full card name as printed",
  "hero_name": "BoBA hero name (e.g., BoJax, Air Jordan, Cutback)",
  "athlete_name": "real athlete name if known",
  "set_code": "set identifier",
  "card_number": "PREFIX-NUMBER from BOTTOM-LEFT (e.g., BFA-5, NOT the power value)",
  "power": null or the large number from TOP-RIGHT,
  "rarity": "common/uncommon/rare/ultra_rare/legendary",
  "variant": "base/foil/battlefoil/paper/inspired_ink",
  "parallel": "specific parallel name if identifiable",
  "weapon_type": "Fire/Ice/Steel/Hex/Glow/Brawl/Gum/Super",
  "confidence": 0.0 to 1.0
}

IMPORTANT: The card_number field must contain the small text from the BOTTOM-LEFT corner. If you can only see a large number (like 200), that is the POWER — look harder at the bottom-left for the actual card number with a letter prefix.`
						}
					]
				}
			]
		});

		const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
		console.log(`[api/scan] Claude raw response: ${text.substring(0, 500)}`);

		// Extract JSON from response
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			console.warn('[api/scan] No JSON found in Claude response');
			return json({ success: false, raw: text, method: 'claude' }, { status: 422 });
		}

		let cardData;
		try {
			cardData = JSON.parse(jsonMatch[0]);
		} catch (err) {
			console.debug('[api/scan] Claude response JSON parse failed:', err);
			console.warn('[api/scan] Failed to parse JSON from Claude response');
			return json({ success: false, raw: text, method: 'claude' }, { status: 422 });
		}

		// ── Validate card_number isn't actually the power value ──────
		// Common failure mode: Haiku returns the power (large top-right number)
		// instead of the card number (small bottom-left text with a prefix).
		const KNOWN_POWER_VALUES = new Set([
			55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120,
			125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175, 180,
			185, 190, 195, 200, 250
		]);

		const rawCardNumber = String(cardData.card_number || '').trim();
		const parsedAsNumber = parseInt(rawCardNumber, 10);

		// If the "card_number" is a bare number that matches a common power value,
		// and the power field contains the same number, it's almost certainly wrong.
		if (
			!rawCardNumber.includes('-') &&
			!isNaN(parsedAsNumber) &&
			KNOWN_POWER_VALUES.has(parsedAsNumber) &&
			(cardData.power === parsedAsNumber || cardData.power === rawCardNumber)
		) {
			console.warn(
				`[api/scan] Suspected power-as-card-number: card_number="${rawCardNumber}" matches power=${cardData.power}. ` +
				`Clearing card_number to force hero-based fallback.`
			);
			// Clear the card_number so the client-side pipeline tries hero-based lookup
			cardData.card_number = null;
			// Reduce confidence since we can't trust the identification
			cardData.confidence = Math.min(cardData.confidence || 0.5, 0.6);
		}

		console.log(`[api/scan] Claude identified: card_number="${cardData.card_number}", hero="${cardData.hero_name}", confidence=${cardData.confidence}`);

		// Track scan in database (only for authenticated users)
		if (user && locals.supabase) {
			try {
				await locals.supabase.from('scans').insert({
					user_id: user.id,
					scan_method: 'claude',
					confidence: cardData.confidence || null,
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
