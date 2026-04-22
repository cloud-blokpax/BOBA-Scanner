/**
 * Tier 1 canonical OCR pass on the captured high-res frame.
 *
 * This is the authoritative result — live-OCR consensus (from
 * live-ocr-coordinator) is a speed hint. Any divergence is logged and
 * the canonical result wins.
 */

import { initPaddleOCR, ocrRegion } from './paddle-ocr';
import { REGIONS, regionToPixels } from './ocr-regions';
import { classifyWondersParallel } from './parallel-classifier';
import { ConsensusBuilder } from './consensus-builder';
import { lookupCard, type MirrorCard } from './catalog-mirror';
import { toParallelName } from '$lib/data/wonders-parallels';

export interface CanonicalResult {
	card: MirrorCard | null;
	cardNumber: string | null;
	name: string | null;
	/** Resolved parallel as a human-readable name (e.g. "Classic Foil"). Ready
	 *  for DB write — never the classifier's short code. Null when no parallel
	 *  was determinable. */
	parallel: string | null;
	confidence: number;
	perTask: {
		cardNumber: { raw: string; confidence: number; validated: string | null };
		name: { raw: string; confidence: number; collapsed: string | null };
		/** Telemetry for the parallel decision. `code` is the classifier short
		 *  code (e.g. "cf"); `value` is the human-readable name persisted to
		 *  the DB (e.g. "Classic Foil"). */
		parallel?: { code: string; value: string; confidence: number; ruleFired: string };
	};
}

export async function runCanonicalTier1(
	bitmap: ImageBitmap,
	game: 'boba' | 'wonders'
): Promise<CanonicalResult> {
	await initPaddleOCR();

	const regions = game === 'boba' ? REGIONS.boba : REGIONS.wonders;
	const cardNumberReg = regionToPixels(regions.card_number, bitmap.width, bitmap.height);
	const nameReg = regionToPixels(
		game === 'boba' ? REGIONS.boba.hero_name : REGIONS.wonders.card_name,
		bitmap.width,
		bitmap.height
	);

	const [numRes, nameRes, parallelRes] = await Promise.allSettled([
		ocrRegion(bitmap, cardNumberReg, { minWidth: 800 }),
		ocrRegion(bitmap, nameReg, { minWidth: 1000 }),
		game === 'wonders' ? classifyWondersParallel(bitmap) : Promise.resolve(null)
	]);

	// Use ConsensusBuilder for validation pipeline even though it's one vote each.
	const builder = new ConsensusBuilder(1, game);
	if (numRes.status === 'fulfilled') {
		builder.addVote({
			task: 'card_number',
			rawValue: numRes.value.text,
			confidence: numRes.value.confidence,
			sessionId: 1
		});
	}
	if (nameRes.status === 'fulfilled') {
		builder.addVote({
			task: 'name',
			rawValue: nameRes.value.text,
			confidence: nameRes.value.confidence,
			sessionId: 1
		});
	}
	if (parallelRes.status === 'fulfilled' && parallelRes.value) {
		builder.addVote({
			task: 'parallel',
			rawValue: parallelRes.value.parallel,
			confidence: parallelRes.value.confidence,
			sessionId: 1
		});
	}
	builder.tickFrame();

	const consensus = builder.getConsensus();
	const cardNumber = consensus.cardNumber?.value || null;
	const name = consensus.name?.value || null;

	let card: MirrorCard | null = null;
	if (cardNumber && name) {
		try {
			card = await lookupCard(game, cardNumber, name);
		} catch (err) {
			console.debug('[tier1-canonical] lookupCard failed', err);
		}
	}

	// Resolve the parallel for DB write. cards.parallel is the source of truth
	// for BoBA (encoded into card_number prefix). For Wonders, map the
	// classifier short code to the human-readable DB name.
	let parallel: string | null = null;
	if (game === 'boba' && card) {
		parallel = card.parallel ?? 'Paper';
	} else if (game === 'wonders') {
		const liveCode = parallelRes.status === 'fulfilled' && parallelRes.value
			? parallelRes.value.parallel
			: null;
		parallel = toParallelName(liveCode) ?? 'Paper';
	}

	return {
		card,
		cardNumber,
		name,
		parallel,
		confidence: Math.min(
			consensus.cardNumber?.summedConfidence ?? 0,
			consensus.name?.summedConfidence ?? 0
		),
		perTask: {
			cardNumber: {
				raw: numRes.status === 'fulfilled' ? numRes.value.text : '',
				confidence: numRes.status === 'fulfilled' ? numRes.value.confidence : 0,
				validated: cardNumber
			},
			name: {
				raw: nameRes.status === 'fulfilled' ? nameRes.value.text : '',
				confidence: nameRes.status === 'fulfilled' ? nameRes.value.confidence : 0,
				collapsed: name
			},
			...(parallelRes.status === 'fulfilled' && parallelRes.value
				? {
						parallel: {
							code: parallelRes.value.parallel,
							value: toParallelName(parallelRes.value.parallel) ?? '',
							confidence: parallelRes.value.confidence,
							ruleFired: parallelRes.value.ruleFired
						}
					}
				: {})
		}
	};
}
