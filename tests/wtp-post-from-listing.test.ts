/**
 * Tests for postOneFromListing — the listing_templates → WTP post path.
 *
 * Verifies the data-shaping: listing row + cards row → BuildWtpPayloadInput.
 * The poster, posting-tracker, and credentials are mocked so we only
 * exercise the resolve-and-shape logic in post-from-listing.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ensurePending = vi.fn();
const markPosted = vi.fn();
const markFailed = vi.fn();
const postListingToWtp = vi.fn();

vi.mock('$lib/server/wtp/posting-tracker', () => ({
	ensurePending: (...args: unknown[]) => ensurePending(...args),
	markPosted: (...args: unknown[]) => markPosted(...args),
	markFailed: (...args: unknown[]) => markFailed(...args)
}));

vi.mock('$lib/server/wtp/poster', () => ({
	postListingToWtp: (...args: unknown[]) => postListingToWtp(...args)
}));

import { postOneFromListing } from '../src/lib/server/wtp/post-from-listing';

interface FakeRow {
	listingRow?: Record<string, unknown> | null;
	cardRow?: Record<string, unknown> | null;
}

function fakeAdmin(rows: FakeRow) {
	return {
		from(table: string) {
			if (table === 'listing_templates') {
				return {
					select() {
						return this;
					},
					eq() {
						return this;
					},
					maybeSingle() {
						return Promise.resolve({ data: rows.listingRow ?? null, error: null });
					}
				};
			}
			if (table === 'cards') {
				return {
					select() {
						return this;
					},
					eq() {
						return this;
					},
					maybeSingle() {
						return Promise.resolve({ data: rows.cardRow ?? null, error: null });
					}
				};
			}
			throw new Error(`Unexpected table ${table}`);
		}
	} as never;
}

const baseListingRow = {
	id: 'listing-1',
	user_id: 'user-1',
	card_id: 'card-1',
	condition: 'Near Mint',
	price: 12.5,
	parallel: 'Paper',
	card_number: '78/402',
	set_code: 'EX',
	scan_image_url: 'https://example.com/scan.jpg',
	description: 'Sharp corners',
	game_id: 'wonders'
};

const baseCardRow = {
	id: 'card-1',
	name: 'Verdant Whisper',
	card_number: '78/402',
	parallel: 'Paper',
	set_code: 'EX',
	rarity: 'Rare',
	image_url: 'https://example.com/card.jpg',
	game_id: 'wonders',
	metadata: {
		set_display_name: 'Existence',
		orbital: 'Heliosynth'
	}
};

beforeEach(() => {
	ensurePending.mockReset();
	markPosted.mockReset();
	markFailed.mockReset();
	postListingToWtp.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('postOneFromListing', () => {
	it('returns listing_not_found when the listing row is missing', async () => {
		const admin = fakeAdmin({ listingRow: null });
		const result = await postOneFromListing(admin, 'user-1', { source_listing_id: 'missing' });
		expect(result).toMatchObject({ ok: false, error_code: 'listing_not_found' });
	});

	it('rejects non-Wonders cards', async () => {
		const admin = fakeAdmin({
			listingRow: baseListingRow,
			cardRow: { ...baseCardRow, game_id: 'boba' }
		});
		const result = await postOneFromListing(admin, 'user-1', { source_listing_id: 'listing-1' });
		expect(result).toMatchObject({ ok: false, error_code: 'wrong_game' });
	});

	it('short-circuits when already posted', async () => {
		const admin = fakeAdmin({ listingRow: baseListingRow, cardRow: baseCardRow });
		ensurePending.mockResolvedValue({
			id: 'posting-1',
			alreadyPosted: true,
			alreadyFailed: false,
			wtp_listing_url: 'https://wtp.example/listing/abc'
		});
		const result = await postOneFromListing(admin, 'user-1', { source_listing_id: 'listing-1' });
		expect(result).toMatchObject({
			ok: true,
			already_posted: true,
			posting_id: 'posting-1',
			wtp_url: 'https://wtp.example/listing/abc'
		});
		expect(postListingToWtp).not.toHaveBeenCalled();
	});

	it('builds payload from card metadata + listing fields and marks posted', async () => {
		const admin = fakeAdmin({ listingRow: baseListingRow, cardRow: baseCardRow });
		ensurePending.mockResolvedValue({ id: 'posting-2', alreadyPosted: false, alreadyFailed: false });
		postListingToWtp.mockResolvedValue({
			wtp_listing_id: 'wtp-42',
			wtp_url: 'https://wtp.example/listing/wtp-42',
			payload: { foo: 'bar' }
		});

		const result = await postOneFromListing(admin, 'user-1', { source_listing_id: 'listing-1' });
		expect(result).toMatchObject({
			ok: true,
			already_posted: false,
			posting_id: 'posting-2',
			wtp_listing_id: 'wtp-42',
			wtp_url: 'https://wtp.example/listing/wtp-42'
		});

		expect(postListingToWtp).toHaveBeenCalledTimes(1);
		const [, , payload, imageUrls] = postListingToWtp.mock.calls[0] as [
			unknown,
			string,
			Record<string, unknown>,
			string[]
		];
		expect(payload).toMatchObject({
			card_name: 'Verdant Whisper',
			treatment: 'paper',
			condition: 'NM',
			set_name: 'Existence',
			rarity: 'Rare',
			orbital: 'Heliosynth',
			price_cents: 1250,
			quantity: 1,
			accepting_offers: true,
			open_to_trade: false
		});
		expect(imageUrls).toEqual([
			'https://example.com/scan.jpg',
			'https://example.com/card.jpg'
		]);

		expect(markPosted).toHaveBeenCalledWith(
			admin,
			'posting-2',
			'wtp-42',
			{ foo: 'bar' },
			'https://wtp.example/listing/wtp-42'
		);
	});

	it('marks failed when buildWtpPayload throws (e.g. unknown condition)', async () => {
		const admin = fakeAdmin({
			listingRow: { ...baseListingRow, condition: 'Pristine' },
			cardRow: baseCardRow
		});
		ensurePending.mockResolvedValue({ id: 'posting-3', alreadyPosted: false, alreadyFailed: false });

		const result = await postOneFromListing(admin, 'user-1', { source_listing_id: 'listing-1' });
		expect(result).toMatchObject({ ok: false, error_code: 'invalid_payload', posting_id: 'posting-3' });
		expect(markFailed).toHaveBeenCalledWith(admin, 'posting-3', expect.any(String));
		expect(postListingToWtp).not.toHaveBeenCalled();
	});

	it('marks failed when poster throws', async () => {
		const admin = fakeAdmin({ listingRow: baseListingRow, cardRow: baseCardRow });
		ensurePending.mockResolvedValue({ id: 'posting-4', alreadyPosted: false, alreadyFailed: false });
		postListingToWtp.mockRejectedValue(new Error('WTP 502'));

		const result = await postOneFromListing(admin, 'user-1', { source_listing_id: 'listing-1' });
		expect(result).toMatchObject({ ok: false, error_code: 'wtp_post_failed', posting_id: 'posting-4' });
		expect(markFailed).toHaveBeenCalledWith(admin, 'posting-4', 'WTP 502');
	});

	it('caller-supplied overrides take precedence over listing defaults', async () => {
		const admin = fakeAdmin({ listingRow: baseListingRow, cardRow: baseCardRow });
		ensurePending.mockResolvedValue({ id: 'posting-5', alreadyPosted: false, alreadyFailed: false });
		postListingToWtp.mockResolvedValue({
			wtp_listing_id: 'wtp-9',
			wtp_url: 'https://wtp.example/listing/wtp-9',
			payload: {}
		});

		await postOneFromListing(admin, 'user-1', {
			source_listing_id: 'listing-1',
			price: 19.99,
			condition: 'Lightly Played',
			quantity: 2,
			shipping_mode: 'flat',
			shipping_fee: 4
		});

		const [, , payload] = postListingToWtp.mock.calls[0] as [
			unknown,
			string,
			Record<string, unknown>,
			string[]
		];
		expect(payload).toMatchObject({
			price_cents: 1999,
			quantity: 2,
			condition: 'LP',
			shipping: { mode: 'flat', fee_cents: 400 }
		});
	});
});
