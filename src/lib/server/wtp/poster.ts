/**
 * WTP listing poster (Option B: posts directly to WTP's PostgREST
 * /rest/v1/listings as the authenticated user).
 *
 * Flow per listing:
 *   1. Mint fresh access token via refresh
 *   2. INSERT row into WTP listings — get back the listing.id
 *   3. Upload images to WTP storage at {wtp_user_id}/{listing_id}_{i}.{ext}
 *   4. PATCH the listing with image_url + image_urls
 *   5. Return WTP listing id + URL
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveSession } from './credentials';
import { uploadImagesToWtp } from './image-relay';
import { wtpFetch } from './wtp-client';
import type { WtpListingPayload } from '$lib/services/wtp/listing-vocab';

export interface PostResult {
	wtp_listing_id: string;
	wtp_url: string;
	payload: WtpListingPayload & { image_urls: string[] };
}

export async function postListingToWtp(
	admin: SupabaseClient,
	userId: string,
	payload: WtpListingPayload,
	imageUrls: string[]
): Promise<PostResult> {
	const session = await getActiveSession(admin, userId);

	const insertBody = { user_id: session.wtp_user_id, ...payload };

	const insRes = await wtpFetch(session, '/rest/v1/listings?select=id', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
		body: JSON.stringify(insertBody)
	});
	if (!insRes.ok) {
		const body = await insRes.text().catch(() => '');
		throw new Error(`WTP listing insert failed (${insRes.status}): ${body.slice(0, 500)}`);
	}
	const inserted = (await insRes.json()) as Array<{ id: string }>;
	const wtpListingId = inserted[0]?.id;
	if (!wtpListingId) {
		throw new Error('WTP listing insert returned no id');
	}

	const uploaded = await uploadImagesToWtp(session, wtpListingId, imageUrls);

	if (uploaded.length > 0) {
		const urls = uploaded.map((u) => u.wtp_url);
		const patchRes = await wtpFetch(session, `/rest/v1/listings?id=eq.${wtpListingId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ image_url: urls[0], image_urls: urls })
		});
		if (!patchRes.ok) {
			console.warn(`[wtp-poster] image PATCH failed ${patchRes.status}`);
		}
	}

	const wtpUrl = `https://wonderstradingpost.com/listing/${wtpListingId}`;

	return {
		wtp_listing_id: wtpListingId,
		wtp_url: wtpUrl,
		payload: { ...payload, image_urls: uploaded.map((u) => u.wtp_url) }
	};
}
