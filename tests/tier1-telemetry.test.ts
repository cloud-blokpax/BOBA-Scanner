import { describe, it, expect } from 'vitest';
import {
	buildTier1TelemetryPayload,
	classifyTier1Miss
} from '../src/lib/services/tier1-telemetry';
import type { CanonicalResult } from '../src/lib/services/tier1-canonical';
import type { LiveOCRSnapshot } from '../src/lib/services/live-ocr-coordinator';
import type { Tier1Detection } from '../src/lib/services/tier1-telemetry.types';

const baseDetection: Tier1Detection = {
	method: 'corner_detected',
	layer: null,
	aspect_ratio: 1.42,
	aspect_ratio_valid: true,
	card_area_pct: null,
	rectification_applied: true,
	corners_clockwise_from_topleft: null,
	rejected_layers_tried: []
};

function emptyCanonical(): CanonicalResult {
	return {
		card: null,
		cardNumber: null,
		name: null,
		parallel: null,
		confidence: 0,
		ocrStrategy: 'region',
		validation: null,
		ocrRegionBatchSize: null,
		ocrRegionTotalMs: null,
		perTask: {
			cardNumber: { raw: '', confidence: 0, validated: null },
			name: { raw: '', confidence: 0, collapsed: null }
		}
	};
}

describe('classifyTier1Miss', () => {
	it('returns null on hit', () => {
		expect(
			classifyTier1Miss({
				hit: true,
				errored: false,
				skipReason: null,
				canonical: emptyCanonical(),
				detection: baseDetection,
				liveConsensusReached: false,
				liveFramesWithText: 0,
				cardNumberPrefixValid: null,
				ocrMeanConfidence: null,
				candidatesReturned: 1,
				catalogRejectReason: null
			})
		).toBeNull();
	});

	it('prefers feature_flag_off over everything', () => {
		expect(
			classifyTier1Miss({
				hit: false,
				errored: true,
				skipReason: 'feature_flag_off',
				canonical: null,
				detection: baseDetection,
				liveConsensusReached: false,
				liveFramesWithText: 0,
				cardNumberPrefixValid: null,
				ocrMeanConfidence: null,
				candidatesReturned: 0,
				catalogRejectReason: null
			})
		).toBe('feature_flag_off');
	});

	it('returns engine_error when errored=true', () => {
		expect(
			classifyTier1Miss({
				hit: false,
				errored: true,
				skipReason: null,
				canonical: null,
				detection: baseDetection,
				liveConsensusReached: false,
				liveFramesWithText: 0,
				cardNumberPrefixValid: null,
				ocrMeanConfidence: null,
				candidatesReturned: 0,
				catalogRejectReason: null
			})
		).toBe('engine_error');
	});

	it('returns detector_no_card when centered_fallback and no live frames and no canonical CN', () => {
		expect(
			classifyTier1Miss({
				hit: false,
				errored: false,
				skipReason: null,
				canonical: emptyCanonical(),
				detection: { ...baseDetection, method: 'centered_fallback' },
				liveConsensusReached: false,
				liveFramesWithText: 0,
				cardNumberPrefixValid: null,
				ocrMeanConfidence: null,
				candidatesReturned: 0,
				catalogRejectReason: null
			})
		).toBe('detector_no_card');
	});

	it('flags detector_wrong_region_suspected for BoBA holo artwork-frame aspect ratio (1.30-1.35)', () => {
		expect(
			classifyTier1Miss({
				hit: false,
				errored: false,
				skipReason: null,
				canonical: emptyCanonical(),
				detection: {
					...baseDetection,
					aspect_ratio: 1.32,
					aspect_ratio_valid: false
				},
				liveConsensusReached: false,
				liveFramesWithText: 0,
				cardNumberPrefixValid: null,
				ocrMeanConfidence: null,
				candidatesReturned: 0,
				catalogRejectReason: null
			})
		).toBe('detector_wrong_region_suspected');
	});

	it('returns aspect_ratio_invalid for pathological aspect ratio', () => {
		expect(
			classifyTier1Miss({
				hit: false,
				errored: false,
				skipReason: null,
				canonical: emptyCanonical(),
				detection: {
					...baseDetection,
					aspect_ratio: 2.5,
					aspect_ratio_valid: false
				},
				liveConsensusReached: false,
				liveFramesWithText: 0,
				cardNumberPrefixValid: null,
				ocrMeanConfidence: null,
				candidatesReturned: 0,
				catalogRejectReason: null
			})
		).toBe('aspect_ratio_invalid');
	});

	it('returns ocr_no_card_number_pattern when text was read but prefix invalid', () => {
		const canonical = emptyCanonical();
		canonical.perTask.name.raw = 'Some Card Name';
		expect(
			classifyTier1Miss({
				hit: false,
				errored: false,
				skipReason: null,
				canonical,
				detection: baseDetection,
				liveConsensusReached: false,
				liveFramesWithText: 1,
				cardNumberPrefixValid: false,
				ocrMeanConfidence: 0.9,
				candidatesReturned: 0,
				catalogRejectReason: null
			})
		).toBe('ocr_no_card_number_pattern');
	});

	it('returns ocr_low_confidence when mean confidence below 0.55', () => {
		const canonical = emptyCanonical();
		canonical.perTask.name.raw = 'foo';
		expect(
			classifyTier1Miss({
				hit: false,
				errored: false,
				skipReason: null,
				canonical,
				detection: baseDetection,
				liveConsensusReached: false,
				liveFramesWithText: 1,
				cardNumberPrefixValid: true,
				ocrMeanConfidence: 0.4,
				candidatesReturned: 0,
				catalogRejectReason: null
			})
		).toBe('ocr_low_confidence');
	});

	it('returns catalog_no_match when OCR succeeded but lookup returned 0', () => {
		const canonical = emptyCanonical();
		canonical.cardNumber = 'BF-99999';
		canonical.perTask.cardNumber.raw = 'BF-99999';
		canonical.perTask.name.raw = 'Phantom';
		expect(
			classifyTier1Miss({
				hit: false,
				errored: false,
				skipReason: null,
				canonical,
				detection: baseDetection,
				liveConsensusReached: true,
				liveFramesWithText: 3,
				cardNumberPrefixValid: true,
				ocrMeanConfidence: 0.85,
				candidatesReturned: 0,
				catalogRejectReason: 'no_match'
			})
		).toBe('catalog_no_match');
	});

	it('falls through to consensus_no_quorum when nothing else matches', () => {
		const canonical = emptyCanonical();
		expect(
			classifyTier1Miss({
				hit: false,
				errored: false,
				skipReason: null,
				canonical,
				detection: baseDetection,
				liveConsensusReached: false,
				liveFramesWithText: 2,
				cardNumberPrefixValid: null,
				ocrMeanConfidence: null,
				candidatesReturned: 0,
				catalogRejectReason: null
			})
		).toBe('consensus_no_quorum');
	});
});

describe('buildTier1TelemetryPayload', () => {
	const baseArgs = {
		captureSource: 'camera_live',
		engineVersion: 'PP-OCRv4-test',
		latencyMs: 1234,
		errored: false,
		errorMessage: null,
		errorCode: null,
		skipReason: null,
		pathTaken: 'canonical' as const,
		gameHint: 'boba',
		confidenceFloor: 0.6,
		canonical: null,
		liveSnapshot: null,
		cardDetectContext: null,
		winningCardId: null,
		winningParallel: null,
		winningConfidence: null,
		winningCardNumber: null,
		winningCardName: null,
		hit: false,
		notes: null
	};

	it('always produces the six required extras sub-objects', () => {
		const payload = buildTier1TelemetryPayload(baseArgs);
		expect(payload.extras.frames).toBeDefined();
		expect(payload.extras.canonical).toBeDefined();
		expect(payload.extras.detection).toBeDefined();
		expect(payload.extras.consensus).toBeDefined();
		expect(payload.extras.catalog_lookup).toBeDefined();
		expect(payload.extras.decision).toBeDefined();
	});

	it('outcome=miss with no canonical and no live snapshot', () => {
		const payload = buildTier1TelemetryPayload(baseArgs);
		expect(payload.outcome).toBe('miss');
		expect(payload.parsed_card_id).toBeNull();
		expect(payload.extras.frames.live_frames_seen).toBe(0);
		expect(payload.extras.canonical.ran).toBe(false);
		expect(payload.extras.decision.path_taken).toBe('canonical');
	});

	it('outcome=hit when winning card supplied', () => {
		const payload = buildTier1TelemetryPayload({
			...baseArgs,
			hit: true,
			winningCardId: 'abc-123',
			winningParallel: 'Battlefoil',
			winningConfidence: 0.92,
			winningCardNumber: 'BF-16',
			winningCardName: 'Bojax'
		});
		expect(payload.outcome).toBe('hit');
		expect(payload.parsed_card_id).toBe('abc-123');
		expect(payload.topn_candidates).toHaveLength(1);
		expect(payload.topn_candidates[0].card_id).toBe('abc-123');
	});

	it('outcome=error when errored=true', () => {
		const payload = buildTier1TelemetryPayload({
			...baseArgs,
			errored: true,
			errorMessage: 'engine init failed'
		});
		expect(payload.outcome).toBe('error');
		expect(payload.error_message).toBe('engine init failed');
		expect(payload.extras.decision.miss_category).toBe('engine_error');
	});

	it('caps ocr_text_raw at 2000 chars', () => {
		const canonical = {
			...emptyCanonical(),
			perTask: {
				cardNumber: { raw: 'x'.repeat(5000), confidence: 0.9, validated: 'x' },
				name: { raw: 'y'.repeat(5000), confidence: 0.9, collapsed: 'y' }
			}
		};
		const payload = buildTier1TelemetryPayload({
			...baseArgs,
			canonical: canonical as unknown as CanonicalResult
		});
		expect((payload.ocr_text_raw ?? '').length).toBeLessThanOrEqual(2000);
		expect((payload.extras.canonical.ocr_full_text ?? '').length).toBeLessThanOrEqual(2000);
	});

	it('populates frames from live snapshot when present', () => {
		const liveSnapshot: LiveOCRSnapshot = {
			sessionId: 5,
			consensus: {
				sessionId: 5,
				reachedThreshold: true,
				cardNumber: {
					value: 'BF-16',
					agreementCount: 3,
					summedConfidence: 2.7,
					votesSeen: 3,
					rawVotes: ['BF-16', 'BF-16', 'BF-16']
				},
				name: {
					value: 'Bojax',
					agreementCount: 3,
					summedConfidence: 2.6,
					votesSeen: 3,
					rawVotes: ['Bojax', 'Bojax', 'Bojax']
				},
				parallel: null,
				setCode: null,
				frameCount: 3
			},
			framesDispatched: 3,
			cyclesRun: 3,
			sessionIdChanges: 1,
			msInAlignedState: 1500,
			pixelStabilityScores: [0.95, 0.94]
		};
		const payload = buildTier1TelemetryPayload({
			...baseArgs,
			liveSnapshot
		});
		expect(payload.extras.frames.live_frames_seen).toBe(3);
		expect(payload.extras.frames.live_consensus_reached).toBe(true);
		expect(payload.extras.frames.live_consensus_top_text).toBe('BF-16');
	});

	it('marks card_number_prefix_valid=true for canonical-readable BoBA prefix', () => {
		const canonical = {
			...emptyCanonical(),
			cardNumber: 'BF-16',
			perTask: {
				cardNumber: { raw: 'BF-16', confidence: 0.9, validated: 'BF-16' },
				name: { raw: 'Bojax', confidence: 0.9, collapsed: 'Bojax' }
			}
		};
		const payload = buildTier1TelemetryPayload({
			...baseArgs,
			canonical: canonical as unknown as CanonicalResult
		});
		expect(payload.extras.consensus.card_number_prefix).toBe('BF');
		expect(payload.extras.consensus.card_number_prefix_valid).toBe(true);
	});

	it('reads detection method/aspect_ratio from cardDetectContext', () => {
		const payload = buildTier1TelemetryPayload({
			...baseArgs,
			cardDetectContext: {
				method: 'centered_fallback',
				aspect_ratio: 1.32,
				detection_layer: null,
				rectification_applied: false
			}
		});
		expect(payload.extras.detection.method).toBe('centered_fallback');
		expect(payload.extras.detection.aspect_ratio).toBe(1.32);
		expect(payload.extras.detection.aspect_ratio_valid).toBe(false);
	});
});
