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
export function getOptimizedImageUrls(src: string, size: ImageSize = 'medium'): {
	avif: string | null;
	webp: string | null;
	fallback: string;
	width: number;
} {
	const width = IMAGE_SIZES[size];

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

export { IMAGE_SIZES, type ImageSize };
