/**
 * Unit tests for src/lib/services/scan-image-url.ts
 *
 * The helper is the single point of conversion from "what we stored" to
 * "what the browser/<img> can fetch", so the path-extraction logic needs
 * to handle every shape the column may hold:
 *   - fresh rows: a storage path like "{uid}/{file}.jpg"
 *   - legacy public URLs: ".../object/public/scan-images/{path}"
 *   - new signed URLs: ".../object/sign/scan-images/{path}?token=..."
 *   - garbage: null/empty/foreign URL
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractScanImagePath, signScanImageUrl } from '../src/lib/services/scan-image-url';

describe('extractScanImagePath', () => {
	it('returns null for empty / non-string inputs', () => {
		expect(extractScanImagePath(null)).toBeNull();
		expect(extractScanImagePath(undefined)).toBeNull();
		expect(extractScanImagePath('')).toBeNull();
		expect(extractScanImagePath('   ')).toBeNull();
	});

	it('returns the path unchanged when input is already a path', () => {
		expect(extractScanImagePath('user-1/abc.jpg')).toBe('user-1/abc.jpg');
		expect(extractScanImagePath('references/card-7.jpg')).toBe('references/card-7.jpg');
	});

	it('strips leading slashes from path-shaped inputs', () => {
		expect(extractScanImagePath('/user-1/abc.jpg')).toBe('user-1/abc.jpg');
	});

	it('extracts the path out of a legacy public URL', () => {
		const url = 'https://x.supabase.co/storage/v1/object/public/scan-images/user-1/abc.jpg';
		expect(extractScanImagePath(url)).toBe('user-1/abc.jpg');
	});

	it('extracts the path out of a signed URL (preserving everything before query)', () => {
		const url =
			'https://x.supabase.co/storage/v1/object/sign/scan-images/user-1/abc.jpg?token=xyz';
		expect(extractScanImagePath(url)).toBe('user-1/abc.jpg');
	});

	it('decodes percent-encoded path segments', () => {
		const url =
			'https://x.supabase.co/storage/v1/object/public/scan-images/user-1/abc%20file.jpg';
		expect(extractScanImagePath(url)).toBe('user-1/abc file.jpg');
	});

	it('returns null for foreign / unrelated URLs', () => {
		expect(extractScanImagePath('https://example.com/image.jpg')).toBeNull();
		expect(
			extractScanImagePath('https://x.supabase.co/storage/v1/object/public/card-images/foo.jpg')
		).toBeNull();
	});
});

describe('signScanImageUrl', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function fakeClient(impl: (path: string, ttl: number) => unknown) {
		return {
			storage: {
				from: vi.fn().mockReturnValue({
					createSignedUrl: vi.fn().mockImplementation(impl)
				})
			}
		} as never;
	}

	it('returns null when client is null', async () => {
		expect(await signScanImageUrl(null, 'user-1/abc.jpg')).toBeNull();
	});

	it('returns null when path cannot be extracted', async () => {
		const client = fakeClient(() => ({ data: null, error: null }));
		expect(await signScanImageUrl(client, '')).toBeNull();
		expect(await signScanImageUrl(client, 'https://example.com/foo.jpg')).toBeNull();
	});

	it('signs against the scan-images bucket using the requested TTL', async () => {
		const createSignedUrl = vi
			.fn()
			.mockResolvedValue({ data: { signedUrl: 'https://signed/url' }, error: null });
		const client = {
			storage: {
				from: vi.fn().mockReturnValue({ createSignedUrl })
			}
		} as never;

		const out = await signScanImageUrl(client, 'user-1/abc.jpg', 600);
		expect(out).toBe('https://signed/url');
		expect((client as { storage: { from: (b: string) => unknown } }).storage.from).toHaveBeenCalledWith(
			'scan-images'
		);
		expect(createSignedUrl).toHaveBeenCalledWith('user-1/abc.jpg', 600);
	});

	it('returns null when Supabase reports an error', async () => {
		const client = fakeClient(() => ({ data: null, error: new Error('boom') }));
		expect(await signScanImageUrl(client, 'user-1/abc.jpg')).toBeNull();
	});

	it('swallows thrown errors and returns null', async () => {
		const client = fakeClient(() => {
			throw new Error('network');
		});
		expect(await signScanImageUrl(client, 'user-1/abc.jpg')).toBeNull();
	});

	it('extracts and signs the path embedded in a legacy public URL', async () => {
		const createSignedUrl = vi
			.fn()
			.mockResolvedValue({ data: { signedUrl: 'https://signed/url' }, error: null });
		const client = {
			storage: {
				from: vi.fn().mockReturnValue({ createSignedUrl })
			}
		} as never;

		await signScanImageUrl(
			client,
			'https://x.supabase.co/storage/v1/object/public/scan-images/user-1/abc.jpg'
		);
		expect(createSignedUrl).toHaveBeenCalledWith('user-1/abc.jpg', 3600);
	});
});
