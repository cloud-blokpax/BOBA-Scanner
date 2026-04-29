/**
 * Server-side image relay for WTP listings.
 *
 * Re-uploads images that originated from Supabase Storage (or any
 * publicly fetchable URL) to WTP's image endpoint, returning the WTP-
 * hosted URL that should be referenced in the listing payload. Most
 * marketplaces require images on their own CDN before a listing can
 * go live.
 *
 * The actual WTP endpoint shape isn't documented here yet — when the
 * v1 wedge ships against a real WTP API the upload call below should
 * be swapped to whatever WTP exposes (multipart upload, signed PUT,
 * etc.). For now this is a thin pass-through so the rest of the flow
 * works against image URLs that are already on a public CDN.
 */

import { getWtpApiBase } from './auth';

export interface RelayedImage {
	original_url: string;
	wtp_url: string;
}

export async function relayImagesToWtp(
	token: string,
	imageUrls: string[]
): Promise<RelayedImage[]> {
	if (!imageUrls.length) return [];

	const apiBase = getWtpApiBase();
	const relayed: RelayedImage[] = [];

	for (const original of imageUrls) {
		try {
			const response = await fetch(`${apiBase}/v1/images/relay`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ source_url: original })
			});

			if (!response.ok) {
				// Fallback: pass the original URL through. WTP may accept
				// already-public URLs depending on its policy. The poster
				// will still surface a clear error if WTP rejects it.
				relayed.push({ original_url: original, wtp_url: original });
				continue;
			}

			const data = (await response.json()) as { url?: string };
			relayed.push({ original_url: original, wtp_url: data.url ?? original });
		} catch {
			relayed.push({ original_url: original, wtp_url: original });
		}
	}

	return relayed;
}
