/**
 * Scan Image Utilities
 *
 * Pure image helper functions used by the recognition pipeline.
 * These operate on ImageBitmap inputs using canvas APIs and have
 * no shared state or recognition-pipeline dependencies.
 */

/**
 * Create a small data-URL thumbnail from a bitmap for scan history display.
 * Produces a ~2-5KB JPEG suitable for IndexedDB/localStorage persistence.
 */
export function createThumbnailDataUrl(bitmap: ImageBitmap): string | null {
	try {
		if (typeof document === 'undefined') return null;

		const MAX_W = 80;
		const MAX_H = 112;
		const scale = Math.min(MAX_W / bitmap.width, MAX_H / bitmap.height, 1);
		const w = Math.round(bitmap.width * scale);
		const h = Math.round(bitmap.height * scale);

		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;

		ctx.drawImage(bitmap, 0, 0, w, h);
		return canvas.toDataURL('image/jpeg', 0.6);
	} catch (err) {
		console.debug('[scan-image-utils] Thumbnail creation failed:', err);
		return null;
	}
}

/**
 * Create a listing-quality JPEG blob from a camera bitmap.
 * If cropRegion is provided, crops to that region first.
 * If no cropRegion, attempts a center-crop to card aspect ratio (5:7).
 * Produces a clean card-focused image for Supabase Storage and eBay.
 */
export function createListingImageBlob(
	bitmap: ImageBitmap,
	cropRegion?: { x: number; y: number; width: number; height: number } | null
): Promise<Blob | null> {
	try {
		if (typeof document === 'undefined') return Promise.resolve(null);

		const CARD_ASPECT = 5 / 7;
		const MAX_W = 600;
		const MAX_H = 840;

		let srcX = 0;
		let srcY = 0;
		let srcW = bitmap.width;
		let srcH = bitmap.height;

		if (cropRegion) {
			srcX = Math.max(0, Math.round(cropRegion.x));
			srcY = Math.max(0, Math.round(cropRegion.y));
			srcW = Math.min(bitmap.width - srcX, Math.round(cropRegion.width));
			srcH = Math.min(bitmap.height - srcY, Math.round(cropRegion.height));
		} else {
			// No crop region — center-crop to card aspect ratio
			const imgAspect = bitmap.width / bitmap.height;
			if (imgAspect > CARD_ASPECT) {
				const targetW = bitmap.height * CARD_ASPECT;
				srcX = Math.round((bitmap.width - targetW) / 2);
				srcW = Math.round(targetW);
			} else if (imgAspect < CARD_ASPECT * 0.85) {
				const targetH = bitmap.width / CARD_ASPECT;
				srcY = Math.round((bitmap.height - targetH) / 2);
				srcH = Math.round(targetH);
			}
		}

		const scale = Math.min(MAX_W / srcW, MAX_H / srcH, 1);
		const outW = Math.round(srcW * scale);
		const outH = Math.round(srcH * scale);

		const canvas = document.createElement('canvas');
		canvas.width = outW;
		canvas.height = outH;
		const ctx = canvas.getContext('2d');
		if (!ctx) return Promise.resolve(null);

		ctx.drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

		return new Promise((resolve) => {
			canvas.toBlob(
				(blob) => resolve(blob),
				'image/jpeg',
				0.85
			);
		});
	} catch (err) {
		console.debug('[scan-image-utils] Listing image creation failed:', err);
		return Promise.resolve(null);
	}
}
