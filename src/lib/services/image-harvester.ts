/**
 * Image Harvester — piggybacks off the price harvester to capture card images
 * from eBay Browse API item summaries. Fire-and-forget, BoBA-only, non-blocking.
 *
 * Called from the BoBA hero pass and BoBA play-card pass of the price harvester
 * with the first filtered itemSummary per card.
 */

import sharp from 'sharp';
import { getAdminClient } from '$lib/server/supabase-admin';

type ItemImageFields = {
	image?: { imageUrl?: string };
	thumbnailImages?: Array<{ imageUrl?: string }>;
};

const RECAPTURE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const FETCH_TIMEOUT_MS = 5_000;
const MIN_IMAGE_BYTES = 1_000;
const BUCKET = 'card-images';

export type CaptureResult = 'captured' | 'skipped' | 'errored';

export async function captureCardImage(
	cardId: string,
	itemSummary: ItemImageFields,
	gameId: string
): Promise<CaptureResult> {
	try {
		if (gameId !== 'boba') return 'skipped';

		const rawUrl =
			itemSummary?.image?.imageUrl ??
			itemSummary?.thumbnailImages?.[0]?.imageUrl;
		if (!rawUrl) return 'skipped';

		const admin = getAdminClient();
		if (!admin) return 'skipped';

		const { data: card, error: cardErr } = await admin
			.from('cards')
			.select('image_url, updated_at')
			.eq('id', cardId)
			.single();
		if (cardErr || !card) return 'skipped';

		if (card.image_url?.includes('/references/')) return 'skipped';

		if (card.image_url?.includes('/harvested/') && card.updated_at) {
			const age = Date.now() - new Date(card.updated_at).getTime();
			if (age < RECAPTURE_TTL_MS) return 'skipped';
		}

		const hiResUrl = rawUrl.replace(/s-l\d+\.jpg/i, 's-l1600.jpg');

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		let response: Response;
		try {
			response = await fetch(hiResUrl, { signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
		if (!response.ok) return 'skipped';

		const contentType = response.headers.get('content-type') ?? '';
		if (!contentType.startsWith('image/')) return 'skipped';

		const buffer = Buffer.from(await response.arrayBuffer());

		if (buffer.length < MIN_IMAGE_BYTES) return 'skipped';

		const processed = await sharp(buffer)
			.rotate()
			.resize(800, 1120, { fit: 'inside' })
			.jpeg({ quality: 88 })
			.toBuffer();

		const storagePath = `harvested/${cardId}.jpg`;

		const { error: uploadErr } = await admin.storage
			.from(BUCKET)
			.upload(storagePath, processed, {
				contentType: 'image/jpeg',
				upsert: true
			});
		if (uploadErr) {
			console.warn(`[harvest:image] upload failed ${cardId}: ${uploadErr.message}`);
			return 'errored';
		}

		const { data: publicData } = admin.storage
			.from(BUCKET)
			.getPublicUrl(storagePath);

		const { error: updateErr } = await admin
			.from('cards')
			.update({
				image_url: publicData.publicUrl,
				updated_at: new Date().toISOString()
			})
			.eq('id', cardId);
		if (updateErr) {
			console.warn(`[harvest:image] db update failed ${cardId}: ${updateErr.message}`);
			return 'errored';
		}

		console.log(`[harvest:image] captured ${cardId} (${processed.length} bytes)`);

		return 'captured';
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.warn(`[harvest:image] error for ${cardId}: ${msg}`);
		return 'errored';
	}
}
