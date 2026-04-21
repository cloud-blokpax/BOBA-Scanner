/**
 * POST /api/scan/embedding — DINOv2 embedding endpoint
 *
 * Uploads a JPEG/PNG image to Hugging Face Inference API (facebook/dinov2-base),
 * returns a 768-d L2-normalized vector that the client then passes to the
 * match_card_embedding RPC for Tier 1 nearest-neighbor lookup.
 *
 * Server-side inference eliminates every failure mode from the client-side
 * OpenCV saga: no WASM, no workers, no iOS Safari quirks.
 *
 * Requires: HF_INFERENCE_TOKEN env var (read-only Hugging Face token).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const HF_ENDPOINT =
	'https://api-inference.huggingface.co/models/facebook/dinov2-base';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const EMBEDDING_DIM = 768;

// DINOv2 inference is typically 1-3s warm, 5-10s cold. Give the function
// enough headroom for HF cold starts without holding the connection indefinitely.
export const config = { maxDuration: 30 };

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) throw error(401, 'unauthorized');

	const token = process.env.HF_INFERENCE_TOKEN;
	if (!token) {
		console.error('[api/scan/embedding] HF_INFERENCE_TOKEN not configured');
		throw error(503, 'embedding service not configured');
	}

	const contentType = request.headers.get('content-type') || '';
	if (!contentType.startsWith('image/')) {
		throw error(400, 'expected image/* body');
	}

	const imageBytes = await request.arrayBuffer();
	if (imageBytes.byteLength === 0) throw error(400, 'empty body');
	if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
		throw error(413, `image too large (max ${MAX_IMAGE_BYTES} bytes)`);
	}

	const startedAt = performance.now();
	let hfResp: Response;
	try {
		hfResp = await fetch(HF_ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': contentType
			},
			body: imageBytes
		});
	} catch (err) {
		console.error('[api/scan/embedding] HF fetch threw', err);
		throw error(502, 'embedding service unreachable');
	}

	if (!hfResp.ok) {
		const bodyText = await hfResp.text().catch(() => '');
		console.error(
			'[api/scan/embedding] HF API error',
			hfResp.status,
			bodyText.slice(0, 200)
		);
		// 503 from HF during cold starts → surface as 503 so the client retries.
		const status = hfResp.status === 503 ? 503 : 502;
		throw error(status, `embedding service returned ${hfResp.status}`);
	}

	let result: unknown;
	try {
		result = await hfResp.json();
	} catch (err) {
		console.error('[api/scan/embedding] HF response JSON parse failed', err);
		throw error(502, 'embedding service returned invalid JSON');
	}

	// HF DINOv2 returns either a flat [float, ...] (CLS token) or a nested
	// [[cls, ...patches]] depending on the revision. Handle both and log any
	// unexpected shape so we catch model updates.
	const vector = extractVector(result);
	if (!vector) {
		console.error(
			'[api/scan/embedding] unexpected HF response shape',
			JSON.stringify(result).slice(0, 200)
		);
		throw error(502, 'embedding service returned unexpected shape');
	}
	if (vector.length !== EMBEDDING_DIM) {
		throw error(
			502,
			`expected ${EMBEDDING_DIM}-dim embedding, got ${vector.length}`
		);
	}

	// L2 normalize so cosine similarity reduces to a dot product. pgvector
	// with vector_cosine_ops accepts any magnitude, but normalizing here
	// keeps similarity scores stable across inference providers if we migrate.
	let sumSq = 0;
	for (let i = 0; i < vector.length; i++) sumSq += vector[i] * vector[i];
	const norm = Math.sqrt(sumSq);
	if (norm === 0) throw error(502, 'zero-norm embedding');
	const normalized = new Array<number>(vector.length);
	for (let i = 0; i < vector.length; i++) normalized[i] = vector[i] / norm;

	return json({
		embedding: normalized,
		model: 'dinov2-base',
		model_version: 'dinov2-base-v1',
		inference_ms: Math.round(performance.now() - startedAt)
	});
};

/**
 * Normalize the three common HF response shapes into a single flat vector.
 */
function extractVector(result: unknown): number[] | null {
	if (Array.isArray(result) && typeof result[0] === 'number') {
		return result as number[];
	}
	if (
		Array.isArray(result) &&
		Array.isArray(result[0]) &&
		typeof (result[0] as unknown[])[0] === 'number'
	) {
		return result[0] as number[];
	}
	if (
		typeof result === 'object' &&
		result !== null &&
		'feature_vector' in result &&
		Array.isArray((result as { feature_vector: unknown }).feature_vector)
	) {
		return (result as { feature_vector: number[] }).feature_vector;
	}
	return null;
}
