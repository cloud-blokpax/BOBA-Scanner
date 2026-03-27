/**
 * POST /api/upload — Secure image upload with CDR
 *
 * Content Disarm & Reconstruction:
 *   - Strips all EXIF/GPS metadata
 *   - Re-encodes as clean JPEG
 *   - Validates file type and size
 *   - Pixel bomb protection
 *
 * Uploads to Supabase Storage.
 */

import { json, error } from '@sveltejs/kit';
import sharp from 'sharp';
import { checkHeavyMutationRateLimit } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

const MAX_FILE_SIZE = 10_000_000; // 10MB
const MAX_PIXELS = 16_000_000;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const POST: RequestHandler = async ({ request, locals }) => {
	const { user } = await locals.safeGetSession();
	if (!user) {
		throw error(401, 'Authentication required');
	}

	const rateLimit = await checkHeavyMutationRateLimit(user.id);
	if (!rateLimit.success) {
		return json({ error: 'Too many uploads' }, {
			status: 429,
			headers: {
				'X-RateLimit-Limit': String(rateLimit.limit),
				'X-RateLimit-Remaining': String(rateLimit.remaining),
				'X-RateLimit-Reset': String(rateLimit.reset)
			}
		});
	}

	const formData = await request.formData();
	const file = formData.get('image');

	if (!file || !(file instanceof File)) {
		throw error(400, 'Image file required');
	}

	if (file.size > MAX_FILE_SIZE) {
		throw error(400, 'File too large (max 10MB)');
	}

	if (!ALLOWED_TYPES.includes(file.type)) {
		throw error(400, 'Invalid file type. Allowed: JPEG, PNG, WebP');
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	// Validate image dimensions
	let metadata;
	try {
		metadata = await sharp(buffer).metadata();
	} catch (err) {
		console.debug('[api/upload] Image metadata read failed:', err);
		throw error(400, 'Invalid image file');
	}

	const width = metadata.width || 0;
	const height = metadata.height || 0;
	if (width === 0 || height === 0) {
		throw error(400, 'Image has zero dimensions');
	}
	const pixels = width * height;
	if (pixels > MAX_PIXELS) {
		throw error(400, 'Image dimensions too large');
	}

	// CDR: strip metadata, re-encode clean
	const clean = await sharp(buffer)
		.rotate()
		.resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
		.jpeg({ quality: 85 })
		.toBuffer();

	const filename = `${user.id}/${Date.now()}.jpg`;

	if (!locals.supabase) {
		throw error(503, 'Storage service unavailable');
	}

	const { data, error: uploadError } = await locals.supabase.storage
		.from('scans')
		.upload(filename, clean, {
			contentType: 'image/jpeg',
			upsert: false
		});

	if (uploadError) {
		console.error('Upload storage error:', uploadError.message);
		throw error(500, 'Image upload failed');
	}

	return json({ path: data.path });
};
