/**
 * Image upload to WTP's storage bucket (card-images).
 *
 * Path convention (matches WTP UI's exact pattern from their bundle):
 *   {wtp_user_id}/{listing_id}_{i}.{ext}
 *
 * Returns the public URL of each successfully uploaded image. Failures
 * are logged but skipped — the listing still goes live, just with fewer
 * images than requested.
 */

import { wtpFetch, getWtpUrl, type WtpSession } from './wtp-client';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — generous; WTP UI doesn't enforce strictly

export interface RelayedImage {
	original_url: string;
	wtp_url: string;
}

export async function uploadImagesToWtp(
	session: WtpSession,
	listingId: string,
	imageUrls: string[]
): Promise<RelayedImage[]> {
	const out: RelayedImage[] = [];

	for (let i = 0; i < imageUrls.length; i++) {
		const original = imageUrls[i];
		try {
			const dl = await fetch(original);
			if (!dl.ok) {
				console.warn(`[wtp-image] download failed ${dl.status}: ${original}`);
				continue;
			}
			const ct = dl.headers.get('content-type') || 'image/jpeg';
			const ext = (ct.split('/')[1] || 'jpg').split(';')[0];
			const blob = await dl.blob();

			if (blob.size > MAX_BYTES) {
				console.warn(`[wtp-image] too large (${blob.size} bytes), skipping`);
				continue;
			}

			const path = `${session.wtp_user_id}/${listingId}_${i}.${ext}`;
			const up = await wtpFetch(session, `/storage/v1/object/card-images/${path}`, {
				method: 'POST',
				headers: { 'Content-Type': ct, 'x-upsert': 'true' },
				body: blob
			});
			if (!up.ok) {
				const text = await up.text().catch(() => '');
				console.warn(`[wtp-image] upload failed ${up.status}: ${text.slice(0, 200)}`);
				continue;
			}

			const wtpUrl = `${getWtpUrl()}/storage/v1/object/public/card-images/${path}`;
			out.push({ original_url: original, wtp_url: wtpUrl });
		} catch (e) {
			console.warn(`[wtp-image] error:`, e);
		}
	}

	return out;
}
