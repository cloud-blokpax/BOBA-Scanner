/**
 * End-to-end tests for the three-tier recognition pipeline.
 *
 * Tests the full flow from recognizeCard() through all tiers
 * with mocked workers, IDB, and network calls.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ── Hoisted mock data ────────────────────────────────────────

const { MOCK_CARDS, mockImageWorker, mockIdb } = vi.hoisted(() => {
	const namedCards = [
		{
			id: 'card-bf108', name: 'Bo Jackson', hero_name: 'Bo Jackson',
			athlete_name: 'Bo Jackson', set_code: 'BF', card_number: 'BF-108',
			parallel: null, power: 95, rarity: 'legendary', weapon_type: 'Bat',
			battle_zone: null, image_url: null, created_at: '2024-01-01'
		},
		{
			id: 'card-pl46', name: 'Speed Demon', hero_name: 'Speed Demon',
			athlete_name: null, set_code: 'PL', card_number: 'PL-46',
			parallel: null, power: 80, rarity: 'rare', weapon_type: 'Sword',
			battle_zone: null, image_url: null, created_at: '2024-01-01'
		},
		{
			id: 'card-bf200', name: 'Shadow Strike', hero_name: 'Shadow Strike',
			athlete_name: null, set_code: 'BF', card_number: 'BF-200',
			parallel: 'Battlefoil', power: 70, rarity: 'uncommon', weapon_type: null,
			battle_zone: null, image_url: null, created_at: '2024-01-01'
		}
	];

	// Generate filler cards to exceed the IDB count reasonableness threshold (>100)
	const fillerCards = Array.from({ length: 100 }, (_, i) => ({
		id: `filler-${i}`, name: `Filler ${i}`, hero_name: `Filler ${i}`,
		athlete_name: null, set_code: 'FILL', card_number: `FIL-${String(i).padStart(3, '0')}`,
		parallel: null, power: 50, rarity: 'common', weapon_type: null,
		battle_zone: null, image_url: null, created_at: '2024-01-01'
	}));

	const MOCK_CARDS = [...namedCards, ...fillerCards];

	const mockImageWorker = {
		computeDHash: vi.fn().mockResolvedValue('abcdef1234567890'),
		hammingDistance: vi.fn().mockReturnValue(0),
		resizeForUpload: vi.fn().mockResolvedValue(new Blob(['fake-image'], { type: 'image/jpeg' })),
		checkBlurry: vi.fn().mockResolvedValue({ isBlurry: false, variance: 500 }),
		checkGlare: vi.fn().mockResolvedValue({ hasGlare: false, regions: [] }),
		analyzeCardPresence: vi.fn().mockResolvedValue({ cardDetected: true, isSharp: true, variance: 500 }),
		preprocessForOCR: vi.fn().mockResolvedValue(new Blob(['preprocessed']))
	};

	const mockIdb = {
		getHash: vi.fn().mockResolvedValue(undefined),
		setHash: vi.fn().mockResolvedValue(undefined),
		getCards: vi.fn().mockResolvedValue(MOCK_CARDS),
		setCards: vi.fn().mockResolvedValue(undefined),
		setCardsVersion: vi.fn().mockResolvedValue(undefined),
		getCardsVersion: vi.fn().mockResolvedValue(null)
	};

	return { MOCK_CARDS, mockImageWorker, mockIdb };
});

// ── Module mocks ─────────────────────────────────────────────

vi.mock('comlink', () => ({
	wrap: vi.fn().mockReturnValue(mockImageWorker),
	expose: vi.fn()
}));

vi.mock('$lib/services/idb', () => ({
	idb: mockIdb,
	scanQueue: {
		add: vi.fn().mockResolvedValue('queued-id'),
		getAll: vi.fn().mockResolvedValue([]),
		remove: vi.fn().mockResolvedValue(undefined),
		count: vi.fn().mockResolvedValue(0)
	}
}));

vi.mock('$lib/services/supabase', () => ({
	supabase: null,
	getSupabase: vi.fn().mockReturnValue(null)
}));

vi.mock('$lib/services/parallel-config', () => ({
	loadParallelConfig: vi.fn().mockResolvedValue(new Map()),
	getParallelRarity: vi.fn().mockReturnValue(null)
}));

vi.mock('$lib/services/ocr', () => ({
	initOcr: vi.fn(),
	recognizeText: vi.fn().mockResolvedValue({ text: '', confidence: 0, words: [] }),
	terminateOcr: vi.fn()
}));

vi.mock('$lib/services/scan-learning', () => ({
	checkCorrection: vi.fn().mockReturnValue(null),
	recordCorrection: vi.fn(),
	loadCorrectionsFromIdb: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/stores/scan-history', () => ({
	addToScanHistory: vi.fn()
}));

vi.mock('$lib/stores/tags', () => ({
	addTag: vi.fn()
}));

vi.mock('$lib/data/boba-config', () => ({
	BOBA_OCR_REGIONS: [{ x: 0, y: 0.84, w: 0.35, h: 0.13, label: 'test' }],
	BOBA_SCAN_CONFIG: {
		quality: 0.85,
		ocrConfidenceThreshold: 30,
		blurThreshold: 100,
		maxUploadSize: 1024,
		aiCostPerScan: 0.003,
		maxFileSize: 10_000_000,
		maxPixels: 16_000_000,
		allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp']
	},
	BOBA_PIPELINE_CONFIG: {
		referenceImageMinVariance: 150,
		maxOcrCorrections: 500,
		ocrWorkerRestartInterval: 50,
		referenceImageMaxDimension: 800,
		referenceImageMinConfidence: 0.8,
		hashFuzzyMaxDistance: 5,
		pHashVerifyMaxDistance: 20,
		hashDistanceConfidencePenalty: 0.015,
	}
}));

// Mock Worker constructor since we're in Node
vi.stubGlobal('Worker', class {
	constructor() {}
	postMessage() {}
	addEventListener() {}
});

// Mock ImageBitmap class (not available in Node)
class MockImageBitmap {
	width = 800;
	height = 600;
	close() {}
}
vi.stubGlobal('ImageBitmap', MockImageBitmap);

// Mock createImageBitmap
vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(new MockImageBitmap()));

// Mock fetch for Tier 3
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock performance.now
vi.stubGlobal('performance', { now: vi.fn().mockReturnValue(0) });

// Mock navigator.onLine (default to online for tests)
Object.defineProperty(globalThis.navigator || (globalThis as Record<string, unknown>).navigator || {}, 'onLine', {
	value: true,
	writable: true,
	configurable: true
});
if (!globalThis.navigator) {
	vi.stubGlobal('navigator', { onLine: true });
}

import { recognizeCard, analyzeFrame, checkImageQuality } from '$lib/services/recognition';
import { loadCardDatabase } from '$lib/services/card-db';

// ── Tests ────────────────────────────────────────────────────

describe('Recognition Pipeline E2E', () => {
	beforeAll(async () => {
		await loadCardDatabase();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockImageWorker.checkBlurry.mockResolvedValue({ isBlurry: false, variance: 500 });
		mockIdb.getHash.mockResolvedValue(undefined);
	});

	describe('blur rejection', () => {
		it('rejects blurry images early without proceeding to recognition', async () => {
			mockImageWorker.checkBlurry.mockResolvedValue({ isBlurry: true, variance: 30 });

			const blob = new Blob(['test'], { type: 'image/jpeg' });
			const result = await recognizeCard(blob);

			expect(result.card_id).toBeNull();
			expect(result.card).toBeNull();
			expect(result.failReason).toContain('blurry');
			// Should not have attempted hash lookup
			expect(mockImageWorker.computeDHash).not.toHaveBeenCalled();
		});
	});

	describe('Tier 1: Hash Cache', () => {
		it('returns cached card when hash matches in IDB', async () => {
			mockIdb.getHash.mockResolvedValue({ card_id: 'card-bf108', confidence: 0.95 });

			const blob = new Blob(['test'], { type: 'image/jpeg' });
			const result = await recognizeCard(blob);

			expect(result.card_id).toBe('card-bf108');
			expect(result.card?.name).toBe('Bo Jackson');
			expect(result.scan_method).toBe('hash_cache');
			expect(result.confidence).toBe(0.95);
			// Should NOT have called fetch (Tier 3)
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('calls tier change callback with tier 1', async () => {
			mockIdb.getHash.mockResolvedValue({ card_id: 'card-bf108', confidence: 0.9 });

			const onTierChange = vi.fn();
			const blob = new Blob(['test'], { type: 'image/jpeg' });
			await recognizeCard(blob, onTierChange);

			expect(onTierChange).toHaveBeenCalledWith(1);
		});
	});

	describe('Tier 3: Claude API fallback', () => {
		it('falls through to Tier 3 when hash cache misses', async () => {
			mockIdb.getHash.mockResolvedValue(undefined);
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({
					success: true,
					card: {
						card_number: 'BF-108',
						hero_name: 'Bo Jackson',
						confidence: 0.92
					}
				}),
				text: () => Promise.resolve('')
			});

			const blob = new Blob(['test'], { type: 'image/jpeg' });
			const result = await recognizeCard(blob);

			expect(result.card_id).toBe('card-bf108');
			expect(result.scan_method).toBe('claude');
			expect(mockFetch).toHaveBeenCalledWith('/api/scan', expect.any(Object));
		});

		it('allows unauthenticated users to proceed to Tier 3', async () => {
			mockIdb.getHash.mockResolvedValue(undefined);
			mockFetch.mockResolvedValue(
				new Response(JSON.stringify({ success: true, card: { card_number: 'BF-108', hero_name: 'Bo Jackson', confidence: 0.9 } }), { status: 200 })
			);

			const blob = new Blob(['test'], { type: 'image/jpeg' });
			const result = await recognizeCard(blob, undefined, { isAuthenticated: false });

			// Unauthenticated users should reach Tier 3 (server-side rate limiting protects against abuse)
			expect(mockFetch).toHaveBeenCalledWith('/api/scan', expect.any(Object));
		});

		it('handles network errors in Tier 3 gracefully', async () => {
			mockIdb.getHash.mockResolvedValue(undefined);
			mockFetch.mockRejectedValue(new Error('Network failure'));

			const blob = new Blob(['test'], { type: 'image/jpeg' });
			const result = await recognizeCard(blob);

			expect(result.card_id).toBeNull();
			expect(result.failReason).toContain('Network error');
		});

		it('handles API error responses in Tier 3', async () => {
			mockIdb.getHash.mockResolvedValue(undefined);
			mockFetch.mockResolvedValue({
				ok: false,
				status: 429,
				text: () => Promise.resolve('Rate limited')
			});

			const blob = new Blob(['test'], { type: 'image/jpeg' });
			const result = await recognizeCard(blob);

			expect(result.card_id).toBeNull();
			expect(result.failReason).toContain('Rate limited');
		});

		it('handles unmatched Claude identification', async () => {
			mockIdb.getHash.mockResolvedValue(undefined);
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({
					success: true,
					card: {
						card_number: 'UNKNOWN-999',
						hero_name: 'Unknown Hero',
						confidence: 0.5
					}
				}),
				text: () => Promise.resolve('')
			});

			const blob = new Blob(['test'], { type: 'image/jpeg' });
			const result = await recognizeCard(blob);

			expect(result.card_id).toBeNull();
			expect(result.failReason).toContain('not found in database');
		});

		it('caches hash after successful Tier 3 identification', async () => {
			mockIdb.getHash.mockResolvedValue(undefined);
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({
					success: true,
					card: {
						card_number: 'PL-46',
						hero_name: 'Speed Demon',
						confidence: 0.88
					}
				}),
				text: () => Promise.resolve('')
			});

			const blob = new Blob(['test'], { type: 'image/jpeg' });
			await recognizeCard(blob);

			// Should have written hash to IDB
			expect(mockIdb.setHash).toHaveBeenCalledWith(
				expect.objectContaining({
					phash: 'abcdef1234567890',
					card_id: 'card-pl46'
				})
			);
		});
	});

	describe('tier progression callbacks', () => {
		it('notifies tier 1 then tier 3 on cache miss', async () => {
			mockIdb.getHash.mockResolvedValue(undefined);
			mockFetch.mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ success: false }),
				text: () => Promise.resolve('')
			});

			const onTierChange = vi.fn();
			const blob = new Blob(['test'], { type: 'image/jpeg' });
			await recognizeCard(blob, onTierChange);

			expect(onTierChange).toHaveBeenCalledWith(1);
			expect(onTierChange).toHaveBeenCalledWith(3);
		});
	});
});

describe('concurrent scans', () => {
	it('handles multiple concurrent recognizeCard calls without interference', async () => {
		// Simulate two concurrent scans — both should complete independently
		mockIdb.getHash
			.mockResolvedValueOnce({ card_id: 'card-bf108', confidence: 0.95 })
			.mockResolvedValueOnce({ card_id: 'card-pl46', confidence: 0.88 });

		const blob1 = new Blob(['test1'], { type: 'image/jpeg' });
		const blob2 = new Blob(['test2'], { type: 'image/jpeg' });

		const [result1, result2] = await Promise.all([
			recognizeCard(blob1),
			recognizeCard(blob2)
		]);

		expect(result1.card_id).toBe('card-bf108');
		expect(result2.card_id).toBe('card-pl46');
		// Each scan should have its own result — no cross-contamination
		expect(result1.card?.name).toBe('Bo Jackson');
		expect(result2.card?.name).toBe('Speed Demon');
	});

	it('concurrent scans with different tier outcomes do not interfere', async () => {
		// First scan: hash cache hit (Tier 1)
		// Second scan: cache miss → Tier 3
		mockIdb.getHash
			.mockResolvedValueOnce({ card_id: 'card-bf108', confidence: 0.95 })
			.mockResolvedValueOnce(undefined);

		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({
				success: true,
				card: { card_number: 'PL-46', hero_name: 'Speed Demon', confidence: 0.9 }
			}),
			text: () => Promise.resolve('')
		});

		const blob1 = new Blob(['test1'], { type: 'image/jpeg' });
		const blob2 = new Blob(['test2'], { type: 'image/jpeg' });

		const [result1, result2] = await Promise.all([
			recognizeCard(blob1),
			recognizeCard(blob2)
		]);

		expect(result1.scan_method).toBe('hash_cache');
		expect(result2.scan_method).toBe('claude');
	});
});

describe('worker initialization resilience', () => {
	it('returns graceful failure when worker throws during scan', async () => {
		mockIdb.getHash.mockResolvedValue(undefined);
		mockImageWorker.computeDHash.mockRejectedValueOnce(new Error('Worker crashed'));
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({
				success: true,
				card: { card_number: 'BF-108', hero_name: 'Bo Jackson', confidence: 0.9 }
			}),
			text: () => Promise.resolve('')
		});

		const blob = new Blob(['test'], { type: 'image/jpeg' });
		const result = await recognizeCard(blob);

		// Should fall through to Tier 3 even if dHash computation fails
		expect(result.card_id).toBe('card-bf108');
		expect(result.scan_method).toBe('claude');
	});
});

describe('analyzeFrame', () => {
	it('returns card detection and sharpness info', async () => {
		mockImageWorker.analyzeCardPresence.mockResolvedValue({
			cardDetected: true,
			isSharp: true,
			variance: 500
		});

		const bitmap = await createImageBitmap(new Blob(['test']));
		const result = await analyzeFrame(bitmap);

		expect(result.cardDetected).toBe(true);
		expect(result.isSharp).toBe(true);
	});
});

describe('checkImageQuality', () => {
	it('returns blur and glare assessment', async () => {
		mockImageWorker.checkBlurry.mockResolvedValue({ isBlurry: false, variance: 500 });
		mockImageWorker.checkGlare.mockResolvedValue({ hasGlare: true, regions: [{ x: 0, y: 0, w: 100, h: 100 }] });

		const bitmap = await createImageBitmap(new Blob(['test']));
		const result = await checkImageQuality(bitmap);

		expect(result.isBlurry).toBe(false);
		expect(result.hasGlare).toBe(true);
		expect(result.glareRegions.length).toBe(1);
	});
});
