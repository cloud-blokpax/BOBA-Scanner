/**
 * POST /api/grade — AI-powered card condition grading via Claude Vision
 *
 * Estimates PSA/BGS grade (1-10 scale) from card images.
 * Supports dual-image mode with centering overlay and corner grid.
 * Auth required. Rate limited.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { checkScanRateLimit } from '$lib/server/rate-limit';
import { buildGradePrompt } from '$lib/server/grading-prompts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	// Auth check
	const { user } = await locals.safeGetSession();
	if (!user) {
		throw error(401, 'Authentication required');
	}

	// Rate limiting (reuse scan limiter — grading is scan-like)
	const rateLimit = await checkScanRateLimit(user.id);
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

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

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

		const apiKey = env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY ?? '';
		if (!apiKey) {
			throw error(500, 'Server configuration error');
		}

		// Build content array — image order matches numbering in the prompt
		const contentParts: Array<Record<string, unknown>> = [];

		if (centeringImageData) {
			contentParts.push({
				type: 'image',
				source: { type: 'base64', media_type: 'image/jpeg', data: centeringImageData }
			});
		}

		contentParts.push({
			type: 'image',
			source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
		});

		if (cornerRegionData) {
			contentParts.push({
				type: 'image',
				source: { type: 'base64', media_type: 'image/jpeg', data: cornerRegionData }
			});
		}

		const prompt = buildGradePrompt(!!centeringImageData, !!cornerRegionData, centeringData || null);
		contentParts.push({ type: 'text', text: prompt });

		const requestBody = JSON.stringify({
			model: 'claude-sonnet-4-6-20250514',
			max_tokens: 1024,
			messages: [{ role: 'user', content: contentParts }]
		});

		// Retry on overload (529)
		let response: Response | undefined;
		const OVERLOAD_RETRIES = [1000, 2000, 3000];
		for (let attempt = 0; attempt <= OVERLOAD_RETRIES.length; attempt++) {
			response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01'
				},
				body: requestBody
			});
			if (response.status !== 529 || attempt === OVERLOAD_RETRIES.length) break;
			await new Promise((r) => setTimeout(r, OVERLOAD_RETRIES[attempt]));
		}

		if (!response || !response.ok) {
			const status = response?.status === 529 ? 503 : 502;
			throw error(status, `AI service error: ${response?.status ?? 'unknown'}`);
		}

		const data = await response.json();

		// Extract and validate the grading JSON from the Claude response
		const text = data?.content?.[0]?.type === 'text' ? data.content[0].text : '';
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			return json({ error: 'Could not parse grading response', raw: text }, { status: 422 });
		}

		let gradeResult;
		try {
			gradeResult = JSON.parse(jsonMatch[0]);
		} catch {
			return json({ error: 'Invalid grading response format', raw: text }, { status: 422 });
		}

		// Validate expected fields exist
		if (typeof gradeResult.grade !== 'number' || gradeResult.grade < 1 || gradeResult.grade > 10) {
			return json({ error: 'Invalid grade value in response', raw: text }, { status: 422 });
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
