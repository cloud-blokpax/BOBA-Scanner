/**
 * Scan-image URL helpers.
 *
 * The `scan-images` Supabase Storage bucket is private (migration 044).
 * Anything that needs to render a scan photo or hand a URL to a third
 * party (eBay Inventory API, WTP composer) MUST go through one of the
 * helpers below to convert a stored path into a short-lived signed URL.
 *
 * Storage layout:
 *   - `{auth_uid}/{scan_id}.jpg`           — uploaded by scan-writer
 *   - `{auth_uid}/{cardId}_{ts}.jpg`       — uploaded when adding to a collection
 *   - `{auth_uid}/listing_{cardId}_{ts}.jpg` — uploaded for eBay listing flow
 *   - `references/{cardId}.jpg`            — submitted as a reference image
 *
 * Backward compat: callers may pass either a storage path ("uid/foo.jpg")
 * or a legacy public URL ("https://xxx.supabase.co/storage/v1/object/
 * public/scan-images/uid/foo.jpg"). Legacy URLs are decomposed to recover
 * the path before signing — old DB rows that still hold public URLs keep
 * working through the helper.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const SCAN_IMAGES_BUCKET = 'scan-images';

const PUBLIC_URL_RE =
	/\/storage\/v1\/object\/(?:public|sign)\/scan-images\/([^?#]+)/i;

/**
 * Best-effort: pull the storage path out of a value that might be a
 * legacy public URL, a freshly-signed URL, or already a path.
 *
 * Returns null if nothing recognizable.
 */
export function extractScanImagePath(value: string | null | undefined): string | null {
	if (!value || typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;

	// Already a storage path (no scheme, no leading /storage prefix).
	if (!trimmed.includes('://') && !trimmed.startsWith('/storage/')) {
		return trimmed.replace(/^\/+/, '');
	}

	const m = trimmed.match(PUBLIC_URL_RE);
	if (m && m[1]) return decodeURIComponent(m[1]);

	return null;
}

/**
 * Sign a scan-image path against the user-scoped Supabase client.
 *
 * `value` may be a path or a legacy URL (see extractScanImagePath).
 * `ttlSeconds` defaults to 1 hour — the standard owner-render window.
 *
 * Returns null on any failure (path can't be parsed, RLS rejects, network error).
 */
export async function signScanImageUrl(
	client: SupabaseClient | null,
	value: string | null | undefined,
	ttlSeconds = 3600
): Promise<string | null> {
	if (!client) return null;
	const path = extractScanImagePath(value);
	if (!path) return null;

	try {
		const { data, error } = await client.storage
			.from(SCAN_IMAGES_BUCKET)
			.createSignedUrl(path, ttlSeconds);
		if (error || !data?.signedUrl) return null;
		return data.signedUrl;
	} catch {
		return null;
	}
}
