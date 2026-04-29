/**
 * WTP listing poster.
 *
 * Takes an already-built WTP payload + a list of image URLs, relays
 * the images, and POSTs the listing to WTP. Returns the resulting
 * WTP listing id and URL.
 *
 * Caller is responsible for building the payload via buildWtpPayload,
 * tracking the wtp_postings row (see posting-tracker.ts), and handling
 * any errors thrown here.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getCredentials } from './credentials';
import { relayImagesToWtp } from './image-relay';
import { getWtpApiBase } from './auth';
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
	const creds = await getCredentials(admin, userId);
	if (!creds) throw new Error('User is not connected to WTP');

	const token = creds.credentials.api_token;
	if (!token) throw new Error('WTP credentials missing api_token');

	const relayed = await relayImagesToWtp(token, imageUrls);
	const fullPayload = { ...payload, image_urls: relayed.map(r => r.wtp_url) };

	const response = await fetch(`${getWtpApiBase()}/v1/listings`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		body: JSON.stringify(fullPayload)
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`WTP listing failed (${response.status}): ${body.slice(0, 500)}`);
	}

	const data = (await response.json()) as {
		listing_id?: string;
		id?: string;
		url?: string;
		listing_url?: string;
	};
	const listingId = data.listing_id ?? data.id;
	const url = data.listing_url ?? data.url;
	if (!listingId || !url) {
		throw new Error('WTP listing response missing listing_id or url');
	}

	return { wtp_listing_id: listingId, wtp_url: url, payload: fullPayload };
}
