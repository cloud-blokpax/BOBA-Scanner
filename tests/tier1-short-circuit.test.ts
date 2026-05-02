import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock catalog-mirror — same pattern as consensus-builder.test.ts.
vi.mock('../src/lib/services/catalog-mirror', () => ({
	lookupCard: vi.fn(),
	lookupCardByCardNumberFuzzy: vi.fn()
}));
// Mock catalog-validation so we control the gate result.
vi.mock('../src/lib/services/catalog-validation', () => ({
	validateCatalogTriangulation: vi.fn()
}));
// Stub checkpoint — it writes to a debug table; tests don't need it.
vi.mock('../src/lib/services/scan-checkpoint', () => ({
	checkpoint: vi.fn()
}));
// Stub the Wonders parallel mapper.
vi.mock('$lib/data/wonders-parallels', () => ({
	toParallelName: (code: string) =>
		code === 'cf' ? 'Classic Foil' : code === 'paper' ? 'Paper' : null
}));

import { lookupCard, lookupCardByCardNumberFuzzy } from '../src/lib/services/catalog-mirror';
import { validateCatalogTriangulation } from '../src/lib/services/catalog-validation';
import { tryLiveShortCircuit } from '../src/lib/services/tier1-short-circuit';
import type { LiveOCRSnapshot } from '../src/lib/services/live-ocr-coordinator';

const baseInputs = {
	gameHint: 'boba',
	isAutoDetect: false,
	cardDetectContext: null,
	traceId: 'test-trace',
	startTime: 0
} as const;

function snap(
	over: Partial<{
		cardNumber: { value: string; agreementCount: number; summedConfidence: number } | null;
		name: { value: string; agreementCount: number; summedConfidence: number } | null;
		parallel: { value: string; agreementCount: number; summedConfidence: number } | null;
		reachedThreshold: boolean;
	}> = {}
): LiveOCRSnapshot {
	return {
		sessionId: 1,
		consensus: {
			sessionId: 1,
			reachedThreshold: over.reachedThreshold ?? true,
			cardNumber:
				over.cardNumber === null
					? null
					: {
							value: 'BBF-82',
							agreementCount: 4,
							summedConfidence: 3.6,
							votesSeen: 4,
							rawVotes: ['BBF-82', 'BBF-82', 'BBF-82', 'BBF-82'],
							...(over.cardNumber ?? {})
						},
			name:
				over.name === null
					? null
					: {
							value: 'Dumper',
							agreementCount: 4,
							summedConfidence: 3.6,
							votesSeen: 4,
							rawVotes: ['Dumper', 'Dumper', 'Dumper', 'Dumper'],
							...(over.name ?? {})
						},
			parallel:
				over.parallel === null
					? null
					: over.parallel
						? {
								value: over.parallel.value ?? 'cf',
								agreementCount: over.parallel.agreementCount ?? 3,
								summedConfidence: over.parallel.summedConfidence ?? 2.7,
								votesSeen: 3,
								rawVotes: []
							}
						: null,
			setCode: null,
			frameCount: 4
		},
		framesDispatched: 4,
		cyclesRun: 4,
		sessionIdChanges: 1,
		msInAlignedState: 2000,
		pixelStabilityScores: [0.99, 0.99, 0.99]
	} as unknown as LiveOCRSnapshot;
}

const mkCard = (over = {}) => ({
	id: '00000000-0000-0000-0000-000000000001',
	game_id: 'boba',
	card_number: 'BBF-82',
	hero_name: 'Dumper',
	name: 'Dumper',
	set_code: 'Griffey Edition',
	parallel: 'Blue Battlefoil',
	...over
});

describe('tryLiveShortCircuit', () => {
	beforeEach(() => {
		vi.mocked(lookupCard).mockReset();
		vi.mocked(lookupCardByCardNumberFuzzy).mockReset();
		vi.mocked(validateCatalogTriangulation).mockReset();
	});

	it('returns null when isAutoDetect=true (no live OCR for auto-detect)', async () => {
		const r = await tryLiveShortCircuit({
			...baseInputs,
			isAutoDetect: true,
			liveConsensusSnapshot: snap()
		});
		expect(r).toBeNull();
	});

	it('returns null when no live snapshot', async () => {
		const r = await tryLiveShortCircuit({
			...baseInputs,
			liveConsensusSnapshot: null
		});
		expect(r).toBeNull();
	});

	it('returns null when reachedThreshold=false', async () => {
		const r = await tryLiveShortCircuit({
			...baseInputs,
			liveConsensusSnapshot: snap({ reachedThreshold: false })
		});
		expect(r).toBeNull();
	});

	it('returns null when card_number agreement < 3', async () => {
		const r = await tryLiveShortCircuit({
			...baseInputs,
			liveConsensusSnapshot: snap({
				cardNumber: { value: 'BBF-82', agreementCount: 2, summedConfidence: 1.8 }
			})
		});
		expect(r).toBeNull();
	});

	it('returns null when card_number summedConfidence < 2.5', async () => {
		const r = await tryLiveShortCircuit({
			...baseInputs,
			liveConsensusSnapshot: snap({
				cardNumber: { value: 'BBF-82', agreementCount: 4, summedConfidence: 2.0 }
			})
		});
		expect(r).toBeNull();
	});

	it('returns null when name agreement < 3', async () => {
		const r = await tryLiveShortCircuit({
			...baseInputs,
			liveConsensusSnapshot: snap({
				name: { value: 'Dumper', agreementCount: 2, summedConfidence: 1.8 }
			})
		});
		expect(r).toBeNull();
	});

	it('returns null when catalog lookup misses', async () => {
		vi.mocked(lookupCard).mockResolvedValue(null);
		vi.mocked(lookupCardByCardNumberFuzzy).mockResolvedValue(null);
		const r = await tryLiveShortCircuit({
			...baseInputs,
			liveConsensusSnapshot: snap()
		});
		expect(r).toBeNull();
	});

	it('returns null when catalog validation fails', async () => {
		vi.mocked(lookupCard).mockResolvedValue(mkCard() as never);
		vi.mocked(validateCatalogTriangulation).mockReturnValue({
			passed: false,
			reason: 'card_number_name_mismatch'
		});
		const r = await tryLiveShortCircuit({
			...baseInputs,
			liveConsensusSnapshot: snap()
		});
		expect(r).toBeNull();
	});

	it('returns a Tier1Outcome when all gates pass (BoBA)', async () => {
		vi.mocked(lookupCard).mockResolvedValue(mkCard() as never);
		vi.mocked(validateCatalogTriangulation).mockReturnValue({ passed: true });
		const r = await tryLiveShortCircuit({
			...baseInputs,
			liveConsensusSnapshot: snap()
		});
		expect(r).not.toBeNull();
		expect(r?.result?.tier1ShortCircuited).toBe(true);
		expect(r?.result?.winningTier).toBe('tier1_live_short_circuit');
		expect(r?.result?.fallbackTierUsed).toBeNull();
		expect(r?.result?.liveVsCanonicalAgreed).toBeNull();
		expect(r?.result?.catalogValidationPassed).toBe(true);
		expect(r?.result?.card?.id).toBe('00000000-0000-0000-0000-000000000001');
	});

	it('Wonders requires parallel agreement', async () => {
		vi.mocked(lookupCard).mockResolvedValue(
			mkCard({ game_id: 'wonders', parallel: 'Classic Foil' }) as never
		);
		vi.mocked(validateCatalogTriangulation).mockReturnValue({ passed: true });
		// No parallel in snapshot → Wonders short-circuit denied.
		const noParallel = await tryLiveShortCircuit({
			...baseInputs,
			gameHint: 'wonders',
			liveConsensusSnapshot: snap({ parallel: null })
		});
		expect(noParallel).toBeNull();
		// With parallel agreement >= 3 it succeeds.
		const withParallel = await tryLiveShortCircuit({
			...baseInputs,
			gameHint: 'wonders',
			liveConsensusSnapshot: snap({
				parallel: { value: 'cf', agreementCount: 3, summedConfidence: 2.5 }
			})
		});
		expect(withParallel).not.toBeNull();
		expect(withParallel?.result?.parallel).toBe('Classic Foil');
	});

	it('falls back to fuzzy lookup when exact lookupCard misses', async () => {
		vi.mocked(lookupCard).mockResolvedValue(null);
		vi.mocked(lookupCardByCardNumberFuzzy).mockResolvedValue(mkCard() as never);
		vi.mocked(validateCatalogTriangulation).mockReturnValue({ passed: true });
		const r = await tryLiveShortCircuit({
			...baseInputs,
			liveConsensusSnapshot: snap()
		});
		expect(r).not.toBeNull();
		expect(vi.mocked(lookupCardByCardNumberFuzzy)).toHaveBeenCalled();
	});
});
