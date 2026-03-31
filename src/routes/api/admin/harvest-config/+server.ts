/**
 * GET/PUT /api/admin/harvest-config — Manage harvest configuration
 *
 * GET  → returns current confidence threshold
 * PUT  → sets confidence threshold (0–100 integer)
 */

import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-guard';
import { getHarvestConfidenceThreshold, setHarvestConfidenceThreshold } from '$lib/server/redis';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	await requireAdmin(locals);

	const threshold = await getHarvestConfidenceThreshold();
	return json({
		confidenceThreshold: Math.round(threshold * 100)
	});
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	await requireAdmin(locals);

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const percent = Number(body.confidenceThreshold);
	if (isNaN(percent) || percent < 0 || percent > 100) {
		throw error(400, 'confidenceThreshold must be 0–100');
	}

	try {
		await setHarvestConfidenceThreshold(percent);
	} catch (err) {
		throw error(503, 'Failed to update threshold — Redis may be unavailable');
	}

	return json({ success: true, confidenceThreshold: percent });
};
