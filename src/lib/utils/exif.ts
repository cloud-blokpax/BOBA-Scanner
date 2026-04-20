/**
 * Lightweight EXIF reader.
 *
 * Reads only a small prefix of the blob (EXIF lives in the first few KB
 * of JPEG/HEIC) and returns at most five non-PII fields. GPS tags are
 * never read and never returned — the call site writes
 * `exif_gps_stripped: true` unconditionally.
 *
 * Never throws. Returns all-null on decode failure, missing EXIF, or
 * environments without the dynamic dep (tests / SSR).
 */

export interface SafeExif {
	make: string | null;
	model: string | null;
	orientation: number | null;
	captureAt: Date | null;
	software: string | null;
}

const EMPTY: SafeExif = {
	make: null,
	model: null,
	orientation: null,
	captureAt: null,
	software: null
};

/**
 * EXIF DateTime values use the format "YYYY:MM:DD HH:MM:SS" — JavaScript's
 * Date constructor does not accept that natively. Swap the date delimiters
 * to hyphens so new Date() can parse it. Returns null on any parse issue.
 */
function parseExifDateTime(raw: string | null | undefined): Date | null {
	if (!raw) return null;
	try {
		const iso = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return null;
		return d;
	} catch {
		return null;
	}
}

export async function parseExifSafe(blob: Blob): Promise<SafeExif> {
	try {
		// EXIF lives in the first few KB. 128KB is generous and keeps us off
		// the critical path for large uploads.
		const slice = blob.slice(0, 131_072);
		const buffer = await slice.arrayBuffer();

		// Dynamic import so the dep only loads when a file upload actually
		// needs EXIF (live camera captures skip this path entirely).
		const mod = await import('exifreader').catch(() => null);
		if (!mod) return EMPTY;

		const ExifReader = (mod as { default?: unknown }).default ?? mod;
		const load = (ExifReader as { load?: (buf: ArrayBuffer, opts?: unknown) => Record<string, { description?: string; value?: unknown }> }).load;
		if (typeof load !== 'function') return EMPTY;

		const tags = load(buffer, { expanded: false, includeUnknown: false });

		// We deliberately read only the five non-PII fields. GPS* keys in
		// `tags` are ignored even though exifreader surfaces them.
		const orientationRaw = tags.Orientation?.value;
		let orientation: number | null = null;
		if (typeof orientationRaw === 'number') {
			orientation = orientationRaw;
		} else if (Array.isArray(orientationRaw) && typeof orientationRaw[0] === 'number') {
			orientation = orientationRaw[0];
		} else if (typeof orientationRaw === 'string' && /^\d+$/.test(orientationRaw)) {
			orientation = parseInt(orientationRaw, 10);
		}

		return {
			make: tags.Make?.description ?? null,
			model: tags.Model?.description ?? null,
			orientation,
			captureAt: parseExifDateTime(tags.DateTimeOriginal?.description),
			software: tags.Software?.description ?? null
		};
	} catch {
		return EMPTY;
	}
}
