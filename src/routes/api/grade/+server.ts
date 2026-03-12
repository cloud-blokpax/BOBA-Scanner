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
import type { RequestHandler } from './$types';

function buildGradePrompt(
	hasCenteringOverlay: boolean,
	hasCornersGrid: boolean,
	centeringData: { lr?: string; tb?: string } | null
): string {
	let imageIndex = 1;
	const imageRefs: Record<string, number> = {};
	if (hasCenteringOverlay) imageRefs.centering = imageIndex++;
	imageRefs.fullCard = imageIndex++;
	if (hasCornersGrid) imageRefs.corners = imageIndex++;

	const totalImages = imageIndex - 1;

	let imageContext = `${totalImages} image${totalImages > 1 ? 's are' : ' is'} provided:\n`;
	if (hasCenteringOverlay) {
		imageContext += `${imageRefs.centering}. CENTERING OVERLAY — The card stripped of background, with colored dashed lines marking the detected printed border boundaries on each side. L/R and T/B ratios are labeled; line color = centering quality (green ≤55/45 = PSA 10, lime ≤60/40 = PSA 9, amber ≤65/35 = PSA 8, orange ≤70/30 = PSA 7, red = PSA 6 or below). Use these measured values as the centering in your response.\n`;
	}
	imageContext += `${imageRefs.fullCard}. FULL CARD IMAGE — Use for overall condition assessment, surface evaluation, and any centering the overlay cannot cover (e.g. card back).\n`;
	if (hasCornersGrid) {
		imageContext += `${imageRefs.corners}. CORNER GRID — 2×2 zoomed grid of all 4 corners (TL/TR top row, BL/BR bottom row). Use for precise corner and edge assessment.`;
	}

	const cornersInstr = hasCornersGrid
		? `1. CORNERS — Using the zoomed corner grid (image ${imageRefs.corners}), assess EACH corner individually:
   - Top-left: sharp/crisp, slightly rounded, moderately rounded, or clearly dinged/damaged?
   - Top-right: same assessment
   - Bottom-left: same assessment
   - Bottom-right: same assessment
   Compare corners — are some worse than others? Note any whitening, fuzzing/fraying, rounding, dings, bends, or chipping.`
		: `1. CORNERS — Assess each corner (top-left, top-right, bottom-left, bottom-right): sharp/crisp, slightly rounded, or clearly rounded/dinged? Note any whitening, fraying, or damage and which corners are affected.`;

	const edgesInstr = hasCornersGrid
		? `2. EDGES — Using the zoomed corners AND full card image, inspect all four edges:
   - Which specific edges (top, bottom, left, right) show wear?
   - Defect types: whitening/chipping, nicks, roughness, fraying, peeling
   - IMPORTANT: For dark-bordered or colored-bordered cards, even tiny white chips on edges are dramatically visible and significantly lower the grade.`
		: `2. EDGES — Check all four edges for chips, nicks, roughness, fraying, or whitening. Note which edges show wear. For dark/colored borders, any whitening on edges is especially grade-impacting.`;

	let centeringBlock: string;
	if (hasCenteringOverlay && centeringData?.lr) {
		centeringBlock = `4. CENTERING — See the centering overlay (image ${imageRefs.centering}).
   Algorithmically computed values:
     Front Left/Right: ${centeringData.lr}
     Front Top/Bottom: ${centeringData.tb || 'see overlay'}
   Use these exact values in your front_centering field.
   For back centering: visually inspect if the reverse is visible; otherwise write "not assessed".`;
	} else if (centeringData?.lr) {
		centeringBlock = `4. CENTERING (algorithmically measured from printed border widths):
   Front Left/Right: ${centeringData.lr}
   Front Top/Bottom: ${centeringData.tb || 'not measured'}
   Use these exact values in your front_centering field.
   For back centering: visually inspect if the reverse is visible; otherwise write "not assessed".`;
	} else {
		centeringBlock = `4. CENTERING — Automated measurement was not available.
   Look at the card's PRINTED borders within the full card image (image ${imageRefs.fullCard}):
   - FRONT: estimate left/right and top/bottom border ratios (e.g. "52/48 L/R, 54/46 T/B").
   - BACK: if the reverse is visible assess it; otherwise write "not assessed".
   - Full-bleed art with no visible printed borders: write "50/50 L/R, 50/50 T/B".`;
	}

	return `You are an expert trading card grader with 20 years of experience grading cards for PSA and BGS.

${imageContext}

NOTE: This card image has been cropped from a larger photo with padding added around the card edges. The outermost border you see is artificial background, not part of the card.

Evaluate these specific attributes:
${cornersInstr}
${edgesInstr}
3. SURFACE — Examine carefully for scratches (hairline/moderate/heavy), print lines vs. scratches distinction, creases, staining, gloss level, and print defects.
${centeringBlock}

PSA GRADE SCALE — use these thresholds (front centering / back centering):
PSA 10 Gem Mint: Perfect. Four sharp corners, full gloss, no staining. Front ≤55/45, back ≤75/25.
PSA 9 Mint: ONE minor flaw only. Front ≤60/40, back ≤90/10.
PSA 8.5 (NM-MT+): High-end NM-MT. Front ≤62/38, back ≤90/10.
PSA 8 Near Mint-Mint: Slightest fraying on 1-2 corners. Front ≤65/35, back ≤90/10.
PSA 7.5 (NM+): High-end NM. Front ≤67/33, back ≤90/10.
PSA 7 Near Mint: Slight fraying on 2-3 corners. Front ≤70/30, back ≤90/10.
PSA 6 Excellent-Mint: Visible graduated corner fraying, slight edge notching. Front ≤80/20.
PSA 5 Excellent: Corner rounding beginning, minor edge chipping. Front ≤85/15.
PSA 4 VG-EX: Slightly rounded corners, light scuffing. Front ≤85/15.
PSA 3 Very Good: Obvious corner rounding, possible crease. Centering ≤90/10.
PSA 2 Good: Accelerated rounding, scratching, staining, chipping.
PSA 1 Poor: Eye appeal nearly vanished.

Half grades (.5): Assign only when card clearly exceeds base grade minimum.
Qualifiers: "OC" (Off Center), "MC" (Miscut), "MK" (Marks), "ST" (Staining), "PD" (Print Defect), "OF" (Out of Focus).

Return ONLY valid JSON:
{
  "grade": <1 to 10>,
  "grade_label": "<grade name>",
  "qualifier": <null or "OC"|"MC"|"MK"|"ST"|"PD"|"OF">,
  "confidence": <0-100>,
  "front_centering": "<L/R> L/R, <T/B> T/B",
  "back_centering": "<L/R> L/R, <T/B> T/B or 'not assessed'",
  "corners": "<describe each corner>",
  "edges": "<describe edge condition>",
  "surface": "<describe surface>",
  "summary": "<2-3 sentence assessment>",
  "submit_recommendation": "yes|maybe|no"
}`;
}

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

	try {
		const { imageData, cornerRegionData, centeringData, centeringImageData } = await request.json();

		if (!imageData) {
			throw error(400, 'Missing image data');
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
			model: 'claude-sonnet-4-6',
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
		return json(data);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('Grade API handler error:', err);
		throw error(500, 'Internal server error');
	}
};
