/**
 * Supabase Storage image transform utilities.
 *
 * Generates optimized image URLs with format and size transforms
 * when images are hosted on Supabase Storage.
 */

const IMAGE_SIZES = {
	thumb: 160,
	medium: 250,
	large: 400
} as const;

type ImageSize = keyof typeof IMAGE_SIZES;

/**
 * Check if a URL is a Supabase Storage URL that supports transforms.
 */
function isSupabaseStorageUrl(url: string): boolean {
	return url.includes('/storage/v1/object/') || url.includes('/storage/v1/render/');
}

/**
 * Generate a Supabase Storage transform URL.
 * Supabase appends ?width=X&format=Y to the render endpoint.
 */
function getSupabaseTransformUrl(url: string, width: number, format: 'avif' | 'webp'): string {
	// Convert /object/ to /render/image/ for transform support
	const renderUrl = url.replace('/storage/v1/object/', '/storage/v1/render/image/');
	const separator = renderUrl.includes('?') ? '&' : '?';
	return `${renderUrl}${separator}width=${width}&format=${format}`;
}

/**
 * Get optimized image URLs for a given source.
 * Returns srcset entries for AVIF, WebP, and the original fallback.
 */
export function getOptimizedImageUrls(src: string | null | undefined, size: ImageSize = 'medium'): {
	avif: string | null;
	webp: string | null;
	fallback: string;
	width: number;
} {
	const width = IMAGE_SIZES[size];

	// Defensive guard: callers TS-type src as 'string' but at runtime
	// callers can accidentally pass a Blob (or other object). When that
	// happens, <img src=Blob> coerces to "[object Blob]" and fires a 404.
	// Surfaced via diagnostic fingerprint fa2b169ec41bba2c — 10+ occurrences
	// per scan in mobile Safari. Returns empty fallback rather than letting
	// the bad value through.
	if (typeof src !== 'string' || src.length === 0) {
		if (src !== null && src !== undefined && typeof src !== 'string') {
			// Log so we can identify the source. Lazy-import to avoid pulling
			// diagnostics into the hot path of normal-render-with-string-src.
			void import('$lib/services/diagnostics-client').then(({ reportClientEvent }) => {
				reportClientEvent({
					level: 'warn',
					event: 'image_url.non_string_input',
					context: {
						actualType: Object.prototype.toString.call(src),
						size
					}
				});
			}).catch(() => { /* swallow */ });
		}
		return { avif: null, webp: null, fallback: '', width };
	}

	if (!isSupabaseStorageUrl(src)) {
		return { avif: null, webp: null, fallback: src, width };
	}

	return {
		avif: getSupabaseTransformUrl(src, width, 'avif'),
		webp: getSupabaseTransformUrl(src, width, 'webp'),
		fallback: src,
		width
	};
}

/**
 * Get the best available image URL for a card.
 *
 * Falls back to the Supabase Storage reference image when the card's
 * image_url field is null (most cards don't have it set yet).
 */
export function getCardImageUrl(
	card: { id: string; image_url?: string | null },
	supabaseUrl?: string
): string | null {
	if (card.image_url) return card.image_url;

	// Construct reference image URL from Supabase Storage
	const url = supabaseUrl || _supabaseUrl;
	if (!url) return null;
	return `${url}/storage/v1/object/public/scans/references/${card.id}.jpg`;
}

/** Cached Supabase URL — set once from dynamic env */
let _supabaseUrl: string | null = null;

/** Initialize the Supabase URL for reference image fallback */
export function initCardImageUrl(supabaseUrl: string): void {
	_supabaseUrl = supabaseUrl;
}

export { IMAGE_SIZES, type ImageSize };
