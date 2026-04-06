/**
 * POST /api/grade — AI-powered card condition grading via Claude Vision
 *
 * Estimates PSA/BGS grade (1-10 scale) from card images.
 * Supports dual-image mode with centering overlay and corner grid.
 * Auth required. Rate limited.
 */

import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { checkScanRateLimit, checkAnonScanRateLimit } from '$lib/server/rate-limit';
import { getAnthropicClient } from '$lib/server/anthropic';
import { parseJsonBody } from '$lib/server/validate';
import { buildGradePrompt } from '$lib/server/grading-prompts';
import type { RequestHandler } from './$types';

// ── Structured output tool definition ──────────────────────────
const GRADE_TOOL: Anthropic.Messages.Tool = {
	name: 'grade_card',
	description: 'Grade a trading card condition on the PSA 1-10 scale',
	input_schema: {
		type: 'object' as const,
		properties: {
			grade: { type: 'number', description: 'PSA grade from 1 to 10 (half grades like 8.5 allowed)' },
			grade_label: { type: 'string', description: 'Grade name (e.g., NM-MT, Mint, etc.)' },
			qualifier: { type: 'string', enum: ['OC', 'MC', 'MK', 'ST', 'PD', 'OF'], description: 'Grade qualifier or null' },
			confidence: { type: 'number', description: '0-100 confidence percentage' },
			front_centering: { type: 'string', description: 'Front L/R and T/B centering ratios' },
			back_centering: { type: 'string', description: 'Back centering or not assessed' },
			corners: { type: 'string', description: 'Corner condition description' },
			edges: { type: 'string', description: 'Edge condition description' },
			surface: { type: 'string', description: 'Surface condition description' },
			summary: { type: 'string', description: '2-3 sentence overall assessment' },
			submit_recommendation: { type: 'string', enum: ['yes', 'maybe', 'no'], description: 'Should this card be submitted for professional grading?' }
		},
		required: ['grade', 'grade_label', 'confidence', 'corners', 'edges', 'surface', 'summary', 'submit_recommendation']
	}
};

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	// Auth required — grading uses Claude Sonnet which is expensive (~$0.03/call)
	const { user } = await locals.safeGetSession();
	if (!user) {
		throw error(401, 'Authentication required for card grading');
	}

	// Pro check — grading is a premium feature (prevents direct API abuse)
	if (!locals.supabase) throw error(503, 'Service unavailable');
	const { data: profile, error: profileErr } = await locals.supabase
		.from('users')
		.select('is_pro, is_admin')
		.eq('auth_user_id', user.id)
		.single();

	if (profileErr) {
		console.error('[grade] Profile lookup failed:', profileErr.message);
		throw error(500, 'Failed to verify account status');
	}
	if (!profile?.is_pro && !profile?.is_admin) {
		throw error(403, 'Pro subscription required for AI grading');
	}

	// Rate limiting (reuse scan limiter — grading is scan-like)
	const rateLimitKey = user.id;
	const rateLimit = await checkScanRateLimit(rateLimitKey);
	if (!rateLimit.success) {
		return json(
			{ error: 'Too many grading requests. Please wait a moment.' },
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

	const body = await parseJsonBody(request);

	try {
		const { imageData, cornerRegionData, centeringData, centeringImageData } = body as {
			imageData?: string;
			cornerRegionData?: string;
			centeringData?: unknown;
			centeringImageData?: string;
		};

		if (!imageData) {
			throw error(400, 'Missing image data');
		}

		// Validate base64 image data format and enforce size limits
		const MAX_BASE64_LENGTH = 15_000_000; // ~11MB decoded
		const base64Pattern = /^[A-Za-z0-9+/\n\r]+=*$/;
		const images = [imageData, cornerRegionData, centeringImageData].filter(Boolean);
		for (const img of images) {
			if (typeof img !== 'string' || img.length > MAX_BASE64_LENGTH || !base64Pattern.test(img)) {
				throw error(400, 'Invalid image data');
			}
		}

		// Verify the images are actually JPEG by checking the magic bytes
		// JPEG files start with FF D8 FF (base64: /9j/)
		if (!imageData.startsWith('/9j/')) {
			throw error(400, 'Image must be JPEG format');
		}
		if (cornerRegionData && !cornerRegionData.startsWith('/9j/')) {
			throw error(400, 'Corner region image must be JPEG format');
		}
		if (centeringImageData && !centeringImageData.startsWith('/9j/')) {
			throw error(400, 'Centering image must be JPEG format');
		}

		// Build content array — image order matches numbering in the prompt
		const contentParts: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

		if (centeringImageData) {
			(contentParts as Anthropic.ContentBlockParam[]).push({
				type: 'image',
				source: { type: 'base64', media_type: 'image/jpeg', data: centeringImageData }
			});
		}

		(contentParts as Anthropic.ContentBlockParam[]).push({
			type: 'image',
			source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
		});

		if (cornerRegionData) {
			(contentParts as Anthropic.ContentBlockParam[]).push({
				type: 'image',
				source: { type: 'base64', media_type: 'image/jpeg', data: cornerRegionData }
			});
		}

		const prompt = buildGradePrompt(!!centeringImageData, !!cornerRegionData, centeringData || null);
		(contentParts as Anthropic.ContentBlockParam[]).push({ type: 'text', text: prompt });

		let response;
		try {
			response = await getAnthropicClient().messages.create({
				model: 'claude-sonnet-4-6-20250514',
				max_tokens: 1024,
				tools: [GRADE_TOOL],
				tool_choice: { type: 'tool' as const, name: 'grade_card' },
				messages: [{ role: 'user', content: contentParts }]
			});
		} catch (err) {
			if (err instanceof Anthropic.APIError) {
				if (err.status === 529) throw error(503, 'AI service temporarily overloaded. Please retry.');
				throw error(502, 'AI service error');
			}
			throw err;
		}

		// Extract structured tool-use result (guaranteed valid JSON)
		const toolUse = response.content.find(block => block.type === 'tool_use');
		if (!toolUse || toolUse.type !== 'tool_use') {
			console.warn('[api/grade] No tool_use block in Claude response');
			return json({ error: 'Could not parse grading response' }, { status: 422 });
		}

		const gradeResult = toolUse.input as Record<string, unknown>;

		// Validate expected fields exist
		if (typeof gradeResult.grade !== 'number' || (gradeResult.grade as number) < 1 || (gradeResult.grade as number) > 10) {
			return json({ error: 'Invalid grade value in response' }, { status: 422 });
		}

		return json({
			grade: gradeResult.grade,
			grade_label: gradeResult.grade_label ?? null,
			qualifier: gradeResult.qualifier ?? null,
			confidence: gradeResult.confidence ?? null,
			front_centering: gradeResult.front_centering ?? null,
			back_centering: gradeResult.back_centering ?? null,
			corners: gradeResult.corners ?? null,
			edges: gradeResult.edges ?? null,
			surface: gradeResult.surface ?? null,
			summary: gradeResult.summary ?? null,
			submit_recommendation: gradeResult.submit_recommendation ?? null
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('Grade API handler error:', err);
		throw error(500, 'Internal server error');
	}
};
