/**
 * Integration tests for GET /api/price/[cardId]
 *
 * Tests the price endpoint's validation, caching, and eBay API interaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────

const mockIsEbayConfigured = vi.fn();
const mockEbayFetch = vi.fn();
vi.mock('$lib/server/ebay-auth', () => ({
	isEbayConfigured: () => mockIsEbayConfigured(),
	ebayFetch: (...args: unknown[]) => mockEbayFetch(...args)
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GET } from '../src/routes/api/price/[cardId]/+server';

// ── Helpers ──────────────────────────────────────────────────

function makeLocals() {
	return {
		safeGetSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
		supabase: {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							single: vi.fn().mockResolvedValue({ data: null })
						}),
						single: vi.fn().mockResolvedValue({
							data: { name: 'Bo Jackson', hero_name: 'Boz', athlete_name: 'Bo Jackson', card_number: 'BF-108', set_code: 'ALPHA', parallel: null, weapon_type: 'Steel' }
						}),
						maybeSingle: vi.fn().mockResolvedValue({
							data: { name: 'Bo Jackson', hero_name: 'Boz', athlete_name: 'Bo Jackson', card_number: 'BF-108', set_code: 'ALPHA', parallel: null, weapon_type: 'Steel' }
						})
					})
				}),
				upsert: vi.fn().mockResolvedValue({})
			})
		}
	};
}

function makeEvent(cardId: string, locals?: ReturnType<typeof makeLocals>) {
	return {
		params: { cardId },
		// Phase 2.5: handler reads variant from url.searchParams (default 'paper')
		url: new URL(`https://example.test/api/price/${encodeURIComponent(cardId)}`),
		locals: locals || makeLocals(),
		getClientAddress: () => '127.0.0.1'
	};
}

describe('GET /api/price/[cardId]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsEbayConfigured.mockReturnValue(true);
	});

	describe('input validation', () => {
		it('rejects invalid card ID format', async () => {
			const event = makeEvent('../../etc/passwd');
			await expect(
				GET(event as any)
			).rejects.toMatchObject({ status: 400 });
		});

		it('rejects empty card ID', async () => {
			const event = makeEvent('');
			await expect(
				GET(event as any)
			).rejects.toMatchObject({ status: 400 });
		});

		it('accepts valid UUID-like card IDs', async () => {
			mockEbayFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ itemSummaries: [] })
			});

			const event = makeEvent('abc-123-def');
			const response = await GET(event as any);
			expect(response.status).toBe(200);
		});
	});

	describe('eBay not configured', () => {
		it('returns 503 when eBay is not configured', async () => {
			mockIsEbayConfigured.mockReturnValue(false);
			const event = makeEvent('card-1');
			const response = await GET(event as any);
			expect(response.status).toBe(503);

			const body = await response.json();
			expect(body.error).toContain('not available');
		});
	});

	describe('price calculation', () => {
		it('returns price data from eBay listings', async () => {
			mockEbayFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({
					itemSummaries: [
						{ title: 'BoBA Battle Arena Boz BF-108 Steel', price: { value: '5.00' } },
						{ title: 'BoBA Battle Arena Boz BF-108 Steel', price: { value: '10.00' } },
						{ title: 'BoBA Battle Arena Boz BF-108 Steel', price: { value: '15.00' } },
						{ title: 'BoBA Battle Arena Boz BF-108 Steel', price: { value: '20.00' } }
					]
				})
			});

			const event = makeEvent('card-1');
			const response = await GET(event as any);
			const body = await response.json();

			expect(body.price_low).toBe(5);
			expect(body.price_mid).toBe(12.5); // proper median of [5, 10, 15, 20] = (10+15)/2
			expect(body.price_high).toBe(20);
			expect(body.listings_count).toBe(4);
		});

		it('returns null prices when no listings found', async () => {
			mockEbayFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ itemSummaries: [] })
			});

			const event = makeEvent('card-no-listings');
			const response = await GET(event as any);
			const body = await response.json();

			expect(body.price_low).toBeNull();
			expect(body.price_mid).toBeNull();
			expect(body.price_high).toBeNull();
			expect(body.listings_count).toBe(0);
		});

		it('sets edge cache headers', async () => {
			mockEbayFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ itemSummaries: [] })
			});

			const event = makeEvent('card-1');
			const response = await GET(event as any);
			expect(response.headers.get('Cache-Control')).toContain('s-maxage=14400');
		});
	});
});
