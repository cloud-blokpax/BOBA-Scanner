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

CARD LAYOUT GUIDE:
- Hero name: Large text centered at the top of the card
- Power value: Number displayed in the TOP-RIGHT corner area (NOT the card number)
- Card number: Small text in the BOTTOM-LEFT corner (formats: BF-108, BLBF-84, PL-46, BBF-56, BPL-7, or plain numbers like 76)
- Set identifier: Text on the card border or bottom area (e.g., "Alpha Edition", "2026 Edition")

WEAPON TYPE IDENTIFICATION (by icon color/style):
- Fire: Red flame icon (rare)
- Ice: Blue crystal/snowflake icon (rare)
- Steel: Gray shield icon (common, most frequent)
- Hex: Purple skull/dark magic icon (ultra rare)
- Glow: Yellow/green radioactive glow icon (ultra rare)
- Brawl: Orange fist icon (common, 2026 Edition)
- Gum: Pink bubblegum themed (secret rare)
- Super: Gold-on-black finish, 1/1 superfoil (legendary)

PARALLEL/TREATMENT IDENTIFICATION:
- Base Paper: Matte, non-reflective surface
- Battlefoil: Holographic foil surface (Silver, Blue, Orange, Green, Pink, Red)
- Named Inserts: Special foil patterns (Blizzard=ice pattern, 80s Rad=neon retro, Headlines=newspaper style, etc.)
- Inspired Ink: On-card autograph (not a sticker), visible signature on the card face

Return ONLY valid JSON with these fields:
{
  "card_name": "full card name as printed",
  "hero_name": "BoBA hero name (e.g., BoJax, Air Jordan, The Kid)",
  "athlete_name": "real athlete name if known (e.g., Bo Jackson, Michael Jordan)",
  "set_code": "set identifier (e.g., Alpha Edition, 2026 Edition)",
  "card_number": "number from BOTTOM-LEFT of card (e.g., BF-108, PL-46)",
  "power": null or number from TOP-RIGHT of card,
  "rarity": "common/uncommon/rare/ultra_rare/legendary",
  "variant": "base/foil/battlefoil/paper/inspired_ink",
  "parallel": "specific parallel name if identifiable (e.g., Blizzard, Silver, Headlines, 80s Rad)",
  "weapon_type": "Fire/Ice/Steel/Hex/Glow/Brawl/Gum/Super",
  "confidence": 0.0 to 1.0
}

Common OCR confusions: 6↔8, 0↔O, 1↔I, B↔8, S↔5.`
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
