/**
 * Phase 2 Doc 2.0 — Pre-shutter consensus short-circuit.
 *
 * When live OCR has reached STRONG consensus before shutter AND the live
 * (card_number, name, parallel) triangulates to a unique catalog row that
 * passes Doc 1.0 validation, return the result immediately and skip the
 * ~500-1500ms canonical OCR pass entirely.
 *
 * Stricter than the live coordinator's own reachedThreshold (which uses
 * 2-of-N agreement, 1.5 summed conf):
 *   - card_number: agreementCount >= 3, summedConfidence >= 2.5
 *   - name:        agreementCount >= 3, summedConfidence >= 2.5
 *   - Wonders:     parallel agreement >= 3 (parallel votes are the
 *                  classifier's short codes; 3 ticks of stable
 *                  classification before shutter is plenty)
 *   - Doc 1.0 catalog validation must PASS against the live values
 *
 * Auto-detect mode (gameHint not set) is excluded — live OCR is
 * configured for one game per session; auto-detect requires trying
 * both games, which only the canonical path does.
 *
 * Any guard failure returns null and the caller falls through to the
 * existing canonical path.
 */

import type { LiveOCRSnapshot } from './live-ocr-coordinator';
import type { ScanResult, Card } from '$lib/types';
import type { Tier1Outcome, Tier1Telemetry } from './recognition-tiers';
import { lookupCard, lookupCardByCardNumberFuzzy } from './catalog-mirror';
import { validateCatalogTriangulation } from './catalog-validation';
import { toParallelName } from '$lib/data/wonders-parallels';
import { checkpoint } from './scan-checkpoint';

const SHORT_CIRCUIT_MIN_AGREEMENT = 3;
const SHORT_CIRCUIT_MIN_SUMMED_CONFIDENCE = 2.5;

export interface ShortCircuitInputs {
	liveConsensusSnapshot: LiveOCRSnapshot | null;
	gameHint: string;
	isAutoDetect: boolean;
	cardDetectContext: Record<string, unknown> | null;
	traceId: string;
	startTime: number;
}

/**
 * Returns a complete Tier1Outcome when the short-circuit applies.
 * Returns null when any gate fails — caller falls through to canonical.
 *
 * Keeping all early-return reasons explicit lets the decisionContext on
 * the eventual canonical scan reflect "we tried to short-circuit and
 * here's why we didn't" — useful for tuning thresholds.
 */
export async function tryLiveShortCircuit(
	inputs: ShortCircuitInputs
): Promise<Tier1Outcome | null> {
	const { liveConsensusSnapshot, gameHint, isAutoDetect, cardDetectContext, traceId, startTime } =
		inputs;

	// Gate 1 — auto-detect mode disqualifies. Live OCR is single-game.
	if (isAutoDetect) return null;

	// Gate 2 — live snapshot must exist with reached threshold AND fields.
	const live = liveConsensusSnapshot?.consensus ?? null;
	if (!live || !live.reachedThreshold) return null;
	if (!live.cardNumber || !live.name) return null;

	// Gate 3 — strict thresholds on each task.
	if (
		live.cardNumber.agreementCount < SHORT_CIRCUIT_MIN_AGREEMENT ||
		live.cardNumber.summedConfidence < SHORT_CIRCUIT_MIN_SUMMED_CONFIDENCE
	) {
		return null;
	}
	if (
		live.name.agreementCount < SHORT_CIRCUIT_MIN_AGREEMENT ||
		live.name.summedConfidence < SHORT_CIRCUIT_MIN_SUMMED_CONFIDENCE
	) {
		return null;
	}

	const game: 'boba' | 'wonders' = gameHint === 'wonders' ? 'wonders' : 'boba';

	// Gate 4 — Wonders requires parallel consensus too. Strict agreement
	// only; the parallel classifier emits short-codes with internal
	// confidence which doesn't compose linearly across votes.
	let liveParallelHumanName: string | null = null;
	if (game === 'wonders') {
		if (!live.parallel || live.parallel.agreementCount < SHORT_CIRCUIT_MIN_AGREEMENT) {
			return null;
		}
		liveParallelHumanName = toParallelName(live.parallel.value);
		if (!liveParallelHumanName) return null;
	}

	// Gate 5 — catalog lookup. Must return a row.
	const cardNumber = live.cardNumber.value;
	const name = live.name.value;
	let card = await safeLookupCard(game, cardNumber, name, liveParallelHumanName);
	if (!card && cardNumber) {
		// Fall back to fuzzy-by-card-number — same path canonical takes
		// when the exact-name index misses. Keeps short-circuit behavior
		// in lock-step with canonical's catalog resolution.
		card = await safeLookupFuzzy(game, cardNumber, name, liveParallelHumanName);
	}
	if (!card) return null;

	// Gate 6 — Doc 1.0 catalog cross-validation. The same gate that runs
	// on the canonical path. If the OCR fields don't triangulate to this
	// candidate, fall through to canonical — which has higher-resolution
	// pixels to work with and may resolve a different (correct) row.
	const validation = validateCatalogTriangulation({
		game,
		ocrCardNumber: cardNumber,
		ocrName: name,
		ocrParallel: liveParallelHumanName,
		candidateCard: card
	});
	if (!validation.passed) return null;

	// All gates pass. Build the Tier1Outcome.
	checkpoint(traceId, 'tier1:short_circuit', performance.now() - startTime, {
		card_number: cardNumber,
		name: name
	});

	const decisionCtx: Record<string, unknown> = {
		live_session: liveConsensusSnapshot,
		short_circuit: {
			thresholds: {
				min_agreement: SHORT_CIRCUIT_MIN_AGREEMENT,
				min_summed_confidence: SHORT_CIRCUIT_MIN_SUMMED_CONFIDENCE
			},
			card_number_agreement: live.cardNumber.agreementCount,
			card_number_summed_confidence: live.cardNumber.summedConfidence,
			name_agreement: live.name.agreementCount,
			name_summed_confidence: live.name.summedConfidence,
			parallel_agreement: live.parallel?.agreementCount ?? null
		},
		canonical_skipped: true,
		catalog_validation: { passed: true, reason: null },
		winning_game: game,
		...(cardDetectContext ? { upload_card_rect: cardDetectContext } : {})
	};

	// Confidence is the minimum per-task summed-confidence-per-vote average.
	// This is a conservative confidence: it's the worst per-frame confidence
	// observed during the live session, not the inflated summed total.
	const cnAvgConf = live.cardNumber.summedConfidence / Math.max(1, live.cardNumber.agreementCount);
	const nmAvgConf = live.name.summedConfidence / Math.max(1, live.name.agreementCount);
	const resolvedConfidence = Math.min(cnAvgConf, nmAvgConf);

	const result: ScanResult = {
		card_id: card.id,
		card: {
			id: card.id,
			game_id: card.game_id,
			card_number: card.card_number,
			hero_name: card.hero_name ?? undefined,
			name: card.name ?? card.hero_name ?? '',
			set_code: card.set_code ?? '',
			parallel: card.parallel ?? undefined
		} as unknown as Card,
		scan_method: 'local_ocr',
		confidence: resolvedConfidence,
		processing_ms: Math.round(performance.now() - startTime),
		parallel: game === 'boba' ? (card.parallel ?? 'Paper') : liveParallelHumanName,
		game_id: card.game_id,
		liveConsensusReached: true,
		liveVsCanonicalAgreed: null, // canonical didn't run
		fallbackTierUsed: null,
		winningTier: 'tier1_live_short_circuit',
		decisionContext: decisionCtx,
		catalogValidationPassed: true,
		catalogValidationFailureReason: null,
		// Phase 2 Doc 2.0 — flag this scan as short-circuit cohort.
		tier1ShortCircuited: true
	};

	const telemetry: Tier1Telemetry = {
		canonical: null,
		tta: null,
		canonicalAttempts: []
	};

	return { result, telemetry };
}

async function safeLookupCard(
	game: 'boba' | 'wonders',
	cardNumber: string,
	name: string,
	parallel: string | null
) {
	try {
		return await lookupCard(game, cardNumber, name, parallel);
	} catch {
		return null;
	}
}

async function safeLookupFuzzy(
	game: 'boba' | 'wonders',
	cardNumber: string,
	name: string,
	parallel: string | null
) {
	try {
		return await lookupCardByCardNumberFuzzy(game, cardNumber, name, parallel);
	} catch {
		return null;
	}
}
