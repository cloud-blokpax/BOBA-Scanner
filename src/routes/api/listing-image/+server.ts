import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getR2Client } from '$lib/server/r2-client';
import { requireAuth } from '$lib/server/validate';

export const config = { maxDuration: 30 };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const R2_PUBLIC_BASE = 'https://pub-78685ab603724112b3087e75342d59b9.r2.dev';
const R2_BUCKET = 'tcg-archive';

// Listing images are intentionally public (eBay fetches them publicly to
// publish on listings). A Supabase signed URL pushes total URL length past
// eBay's 500-char-per-URL limit; an R2 public URL stays ~176 chars.
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireAuth(locals);

	const form = await request.formData();
	const file = form.get('image');
	const cardId = form.get('cardId');
	if (!(file instanceof Blob)) throw error(400, 'image field required');
	if (typeof cardId !== 'string' || !cardId) throw error(400, 'cardId required');
	if (file.size > MAX_IMAGE_BYTES) throw error(413, `image exceeds ${MAX_IMAGE_BYTES} bytes`);

	const setup = await getR2Client();
	if (!setup) throw error(500, 'R2 not configured');

	const filename = `listing_${cardId}_${Date.now()}.jpg`;
	const key = `listing-images/${user.id}/${filename}`;
	const bytes = new Uint8Array(await file.arrayBuffer());

	try {
		await setup.client.send(new PutObjectCommand({
			Bucket: R2_BUCKET,
			Key: key,
			Body: bytes,
			ContentType: 'image/jpeg',
			CacheControl: 'public, max-age=31536000, immutable'
		}));
	} catch (err) {
		console.error('[listing-image] R2 upload failed:', err);
		throw error(500, 'upload failed');
	}

	return json({ url: `${R2_PUBLIC_BASE}/${key}` });
};
