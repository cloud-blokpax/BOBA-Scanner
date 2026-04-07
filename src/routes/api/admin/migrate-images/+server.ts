/**
 * POST /api/admin/migrate-images — Upload images to Supabase Storage
 *
 * Admin-only. Accepts a batch of image mappings from the client,
 * downloads from GCS, uploads to Supabase Storage, and updates image_url.
 *
 * Request body: { images: [{ heroName, weaponType, imageUrl, slug }] }
 * Response: { uploaded, failed, failures? }
 */

import { json, error } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { requireAdmin } from '$lib/server/admin-guard';
import { getAdminClient } from '$lib/server/supabase-admin';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

const STORAGE_BUCKET = 'scans';
const STORAGE_PREFIX = 'card-images';

interface ImageEntry {
	heroName: string;
	weaponType: string | null;
	imageUrl: string;
	slug: string;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	await requireAdmin(locals);

	const admin = getAdminClient();
	if (!admin) throw error(503, 'Admin client not configured');

	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL || '';

	const body = await request.json();
	const images: ImageEntry[] = body.images || [];

	if (images.length === 0) {
		return json({ error: 'No images provided in request body' }, { status: 400 });
	}

	let uploaded = 0, failed = 0;
	const failures: { name: string; error: string }[] = [];

	for (const img of images) {
		const storagePath = `${STORAGE_PREFIX}/${img.slug}.webp`;
		const targetUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;

		try {
			// Download from GCS
			const response = await fetch(img.imageUrl);
			if (!response.ok) {
				failed++;
				failures.push({ name: `${img.heroName} (${img.weaponType})`, error: `GCS ${response.status}` });
				continue;
			}

			const buffer = Buffer.from(await response.arrayBuffer());

			// Upload to Supabase Storage
			const { error: uploadErr } = await admin.storage
				.from(STORAGE_BUCKET)
				.upload(storagePath, buffer, { contentType: 'image/webp', upsert: true });

			if (uploadErr) {
				failed++;
				failures.push({ name: `${img.heroName} (${img.weaponType})`, error: uploadErr.message });
				continue;
			}

			// Update all matching cards (hero_name + weapon_type)
			if (img.weaponType) {
				await admin
					.from('cards')
					.update({ image_url: targetUrl })
					.ilike('hero_name', img.heroName)
					.eq('weapon_type', img.weaponType)
					.is('image_url', null);
			} else {
				await admin
					.from('cards')
					.update({ image_url: targetUrl })
					.ilike('hero_name', img.heroName)
					.is('weapon_type', null)
					.is('image_url', null);
			}

			uploaded++;
		} catch (err) {
			failed++;
			failures.push({ name: `${img.heroName} (${img.weaponType})`, error: String(err) });
		}
	}

	// Also do name-only fallback for any remaining NULL cards
	for (const img of images) {
		if (failed > 0) continue; // skip fallback on errors
		const storagePath = `${STORAGE_PREFIX}/${img.slug}.webp`;
		const targetUrl = `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;

		await admin
			.from('cards')
			.update({ image_url: targetUrl })
			.ilike('hero_name', img.heroName)
			.is('image_url', null);
	}

	return json({
		uploaded,
		failed,
		failures: failures.length ? failures : undefined,
	});
};
