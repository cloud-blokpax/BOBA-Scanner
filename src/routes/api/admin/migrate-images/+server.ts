/**
 * POST /api/admin/migrate-images — Download GCS images → Supabase Storage
 *
 * Admin-only. Each call processes a batch of cards (default 50).
 * Call repeatedly until `remaining === 0`.
 *
 * Query params:
 *   ?batch=50        Number of cards per call (default 50)
 *   ?dryRun=true     Preview without uploading
 *
 * Response: { processed, uploaded, skipped, failed, remaining, failures, done }
 */

import { json, error } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const STORAGE_BUCKET = 'scans';
const STORAGE_PREFIX = 'card-images';
const CONCURRENCY = 5;

/** Extract slug from GCS URL: .../small/SLUG.webp → SLUG */
function extractSlug(gcsUrl: string): string {
	const match = gcsUrl.match(/\/([^/]+)\.webp$/);
	return match ? match[1] : '';
}

export const POST: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Admin client not configured');

	const batchSize = Math.min(Number(url.searchParams.get('batch')) || 50, 100);
	const dryRun = url.searchParams.get('dryRun') === 'true';

	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL || '';

	// 1. Fetch next batch of cards still pointing at GCS
	const { data: cards, error: queryError } = await admin
		.from('cards')
		.select('id, image_url')
		.like('image_url', '%storage.googleapis.com/cardeio-images%')
		.limit(batchSize);

	if (queryError) throw error(500, `Query failed: ${queryError.message}`);
	if (!cards || cards.length === 0) {
		// Count total on supabase to confirm
		const { count } = await admin
			.from('cards')
			.select('id', { count: 'exact', head: true })
			.like('image_url', `${supabaseUrl}/storage%`);

		return json({ processed: 0, uploaded: 0, skipped: 0, failed: 0, remaining: 0, done: true, onSupabase: count });
	}

	// 2. Count total remaining (including this batch)
	const { count: totalRemaining } = await admin
		.from('cards')
		.select('id', { count: 'exact', head: true })
		.like('image_url', '%storage.googleapis.com/cardeio-images%');

	// 3. Process batch with concurrency
	let uploaded = 0;
	let failed = 0;
	let skipped = 0;
	const failures: { id: string; error: string }[] = [];

	async function processCard(card: { id: string; image_url: string }) {
		const slug = extractSlug(card.image_url);
		if (!slug) {
			failed++;
			failures.push({ id: card.id, error: 'Could not extract slug from URL' });
			return;
		}

		const storagePath = `${STORAGE_PREFIX}/${slug}.webp`;

		if (dryRun) {
			uploaded++;
			return;
		}

		try {
			// Download from GCS
			const response = await fetch(card.image_url);
			if (!response.ok) {
				failed++;
				failures.push({ id: card.id, error: `GCS returned ${response.status}` });
				return;
			}

			const buffer = Buffer.from(await response.arrayBuffer());

			// Upload to Supabase Storage
			const { error: uploadError } = await admin.storage
				.from(STORAGE_BUCKET)
				.upload(storagePath, buffer, {
					contentType: 'image/webp',
					upsert: true,
				});

			if (uploadError) {
				failed++;
				failures.push({ id: card.id, error: uploadError.message });
				return;
			}

			// Update the card's image_url to point to Supabase Storage
			const newUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
			const { error: updateError } = await admin
				.from('cards')
				.update({ image_url: newUrl })
				.eq('id', card.id);

			if (updateError) {
				failed++;
				failures.push({ id: card.id, error: `Upload OK but DB update failed: ${updateError.message}` });
				return;
			}

			uploaded++;
		} catch (err) {
			failed++;
			failures.push({ id: card.id, error: String(err) });
		}
	}

	// Process in parallel batches of CONCURRENCY
	for (let i = 0; i < cards.length; i += CONCURRENCY) {
		const batch = cards.slice(i, i + CONCURRENCY);
		await Promise.all(batch.map(processCard));
	}

	const remaining = (totalRemaining ?? 0) - uploaded - skipped;

	return json({
		processed: cards.length,
		uploaded,
		skipped,
		failed,
		remaining: Math.max(0, remaining),
		done: remaining <= 0,
		failures: failures.length > 0 ? failures : undefined,
		dryRun,
	});
};
