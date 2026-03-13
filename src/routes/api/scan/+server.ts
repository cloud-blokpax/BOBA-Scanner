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
import { checkScanRateLimit } from '$lib/server/rate-limit';
import { BOBA_SCAN_CONFIG } from '$lib/data/boba-config';
import type { RequestHandler } from './$types';

const { maxFileSize: MAX_FILE_SIZE, maxPixels: MAX_PIXELS, allowedImageTypes: ALLOWED_TYPES } = BOBA_SCAN_CONFIG;

let _anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
	if (!_anthropic) {
		const apiKey = env.CLAUDE_API_KEY ?? env.ANTHROPIC_API_KEY ?? '';
		_anthropic = new Anthropic({ apiKey });
	}
	return _anthropic;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	// ── Auth check ──────────────────────────────────────────
	const { user } = await locals.safeGetSession();
	if (!user) {
		throw error(401, 'Authentication required');
	}

	// ── Rate limiting ───────────────────────────────────────
	const rateLimit = await checkScanRateLimit(user.id);
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
	} catch {
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
Return ONLY valid JSON with these fields:
{
  "card_name": "full card name",
  "hero_name": "BoBA hero name",
  "athlete_name": "real athlete name if known",
  "set_code": "set identifier (e.g. Alpha Edition, Alpha Blast)",
  "card_number": "number on card (e.g. BF-108, PL-46, 76)",
  "power": null or number,
  "rarity": "common/uncommon/rare/ultra_rare/legendary",
  "variant": "base/foil/holographic/battlefoil/paper",
  "weapon_type": "weapon if visible (Fire/Ice/Steel/Hex/Glow)",
  "confidence": 0.0 to 1.0
}

Common card number formats: "BF-108", "BLBF-84", "PL-46", "BBF-56", "BPL-7", or plain numbers like "76".
Common OCR confusions: 6↔8, 0↔O, 1↔I, B↔8, S↔5.`
						}
					]
				}
			]
		});

		const text = response.content[0]?.type === 'text' ? response.content[0].text : '';

		// Extract JSON from response
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			return json({ success: false, raw: text, method: 'claude' }, { status: 422 });
		}

		let cardData;
		try {
			cardData = JSON.parse(jsonMatch[0]);
		} catch {
			return json({ success: false, raw: text, method: 'claude' }, { status: 422 });
		}

		// Track scan in database
		try {
			await locals.supabase.from('scans').insert({
				user_id: user.id,
				scan_method: 'claude',
				confidence: cardData.confidence || null,
				processing_ms: null
			});
		} catch {
			// Non-critical logging failure
		}

		return json({ success: true, card: cardData, method: 'claude' });
	} catch (err) {
		console.error('Claude API error:', err);

		if (err instanceof Anthropic.APIError) {
			if (err.status === 529) {
				throw error(503, 'AI service temporarily overloaded. Please retry.');
			}
			throw error(502, 'AI service error');
		}

		throw error(500, 'Internal server error');
	}
};
