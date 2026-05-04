/**
 * Tier 1 canonical OCR pass on the captured high-res frame.
 *
 * Two-stage strategy:
 *   Stage 1 (fast)        — region-cropped OCR on the card_number + name strips.
 *   Stage 2 (robust)      — if stage 1 produced weak results, run full-frame OCR
 *                            and merge. Full-frame was validated at 100% accuracy
 *                            on 20 real phone-photographed test cards, so this is
 *                            the safety net that keeps region-coord drift from
 *                            causing correctness failures.
 *
 * This is the authoritative result — live-OCR consensus (from
 * live-ocr-coordinator) is a speed hint. Any divergence is logged and the
 * canonical result wins.
 */

import {
	initPaddleOCR,
	ocrRegion,
	ocrRecOnly,
	ocrRecOnlyBatch,
	ocrFullFrame,
	boxCenterNormalized,
	regionContains,
	pickTopBox,
	type OCRResult
} from './paddle-ocr';
import { featureEnabled } from '$lib/stores/feature-flags.svelte';
import { REGIONS, regionToPixels } from './ocr-regions';
import { classifyWondersParallel } from './parallel-classifier';
import { ConsensusBuilder } from './consensus-builder';
import {
	lookupCard,
	lookupCardByCardNumberFuzzy,
	type MirrorCard
} from './catalog-mirror';
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
	/** Which OCR strategy produced the winning fields. */
	ocrStrategy: 'region' | 'full_frame' | 'mixed';
	/** Phase 1 Doc 1.0 — strict triangulation result. Populated whenever
	 *  the catalog-validation feature flag is enabled; null otherwise. */
	validation: {
		passed: boolean;
		reason: string | null;
	} | null;
	/** Phase 2 Doc 2.4 — region-OCR batching telemetry. NULL when the
	 *  scan didn't reach the region-OCR pass or the flag was off. */
	ocrRegionBatchSize: number | null;
	ocrRegionTotalMs: number | null;
	perTask: {
		cardNumber: { raw: string; confidence: number; validated: string | null };
		name: { raw: string; confidence: number; collapsed: string | null };
		/** Telemetry for the parallel decision. `code` is the classifier short
		 *  code (e.g. "cf"); `value` is the human-readable name persisted to
		 *  the DB (e.g. "Classic Foil"). */
		parallel?: { code: string; value: string; confidence: number; ruleFired: string };
		/** BoBA-only year stamp telemetry (e.g. "2026"). Informational —
		 *  not yet consumed by the resolver. Doc 2 plumbs this end-to-end
		 *  so the bench harness can measure populate rate before downstream
		 *  consumers come online. */
		setCode?: { raw: string; confidence: number; value: string | null };
	};
}

// Validation observed >=0.92 confidence on every correct read across 20
// cards. 0.60 is conservative — below this we fall back to full-frame OCR.
const REGION_CONFIDENCE_FLOOR = 0.6;

interface OCROutputs {
	cardNumber: { raw: string; confidence: number; validated: string | null };
	name: { raw: string; confidence: number; collapsed: string | null };
	/** BoBA-only year stamp (e.g. "2026"). Optional — Wonders REGIONS has
	 *  no set_code ROI, so this stays undefined for that game. Informational
	 *  for now; not used by the resolver. */
	setCode?: { raw: string; confidence: number; value: string | null };
	/** Phase 2 Doc 2.4 — number of regions in the batched call.
	 *  NULL = serial path (flag off or batch-failure fallback). */
	ocrRegionBatchSize?: number | null;
	/** Phase 2 Doc 2.4 — wall-clock for the batched/serial recognition pass. */
	ocrRegionTotalMs?: number | null;
}

export async function runCanonicalTier1(
	bitmap: ImageBitmap,
	game: 'boba' | 'wonders'
): Promise<CanonicalResult> {
	await initPaddleOCR();

	// Stage 1: region-cropped OCR (fast path)
	let regionOut = await runRegionOCR(bitmap, game);
	let activeBitmap: ImageBitmap = bitmap;
	// When the 180° retry creates a rotated bitmap we own, this holds it so
	// callers don't have to know about the rotation. Closed at end of fn.
	let rotatedRetryBitmap: ImageBitmap | null = null;

	// Phase 1 Doc 1.2 — 180° retry safety net. Only fires when EVERYTHING
	// is missing on the region path. EXIF correction handles the common
	// case; this catches the rare "EXIF tag was wrong/absent and the photo
	// is upside-down" failure mode.
	const bothRegionsFailed =
		!regionOut.cardNumber.validated && !regionOut.name.collapsed;
	if (bothRegionsFailed) {
		try {
			const orientFlag = await (async () => {
				try {
					const m = await import('$lib/stores/feature-flags.svelte');
					return m.featureEnabled('phase1_orientation_correction_v1')();
				} catch { return false; }
			})();
			if (orientFlag) {
				const { rotateBitmap } = await import('./orientation-correction');
				const rotated = await rotateBitmap(bitmap, 180);
				let usedRotated = false;
				try {
					const retry = await runRegionOCR(rotated, game);
					const retryHasField = !!retry.cardNumber.validated || !!retry.name.collapsed;
					if (retryHasField) {
						regionOut = retry;
						activeBitmap = rotated;
						rotatedRetryBitmap = rotated;
						usedRotated = true;
					}
				} finally {
					if (!usedRotated) {
						try { rotated.close(); } catch { /* ignore */ }
					}
				}
			}
		} catch (err) {
			console.debug('[tier1-canonical] 180° retry skipped', err);
		}
	}

	let strategy: CanonicalResult['ocrStrategy'] = 'region';
	let merged: OCROutputs = regionOut;

	// Stage 2: fall back to full-frame OCR when stage 1 is weak
	const regionLooksBad =
		!regionOut.cardNumber.validated ||
		!regionOut.name.collapsed ||
		regionOut.cardNumber.confidence < REGION_CONFIDENCE_FLOOR ||
		regionOut.name.confidence < REGION_CONFIDENCE_FLOOR;

	if (regionLooksBad) {
		try {
			const fullOut = await runFullFrameOCR(activeBitmap, game);
			merged = mergeOCROutputs(regionOut, fullOut);
			strategy =
				regionOut.cardNumber.validated || regionOut.name.collapsed ? 'mixed' : 'full_frame';
		} catch (err) {
			console.debug('[tier1-canonical] full-frame fallback failed', err);
		}
	}

	// Parallel classification (Wonders only)
	const parallelRes = game === 'wonders' ? await safeClassifyParallel(activeBitmap) : null;

	let parallelHumanName: string | null = null;
	let parallelPerTask: CanonicalResult['perTask']['parallel'] | undefined;
	if (game === 'wonders') {
		const code = parallelRes?.parallel ?? null;
		parallelHumanName = toParallelName(code) ?? 'Paper';
		if (parallelRes) {
			parallelPerTask = {
				code: parallelRes.parallel,
				value: toParallelName(parallelRes.parallel) ?? 'Paper',
				confidence: parallelRes.confidence,
				ruleFired: parallelRes.ruleFired
			};
		}
	}

	// Catalog lookup — exact first, then fuzzy-by-card-number as fallback.
	// For Wonders, parallelHumanName (from the classifier above) is required
	// to disambiguate among same-(card_number, name) rows post-expansion;
	// without it the lookup returns a parallel-blind first match, and
	// final_card_id ends up pointing at the wrong parallel's row.
	const lookupParallel = game === 'wonders' ? parallelHumanName : null;
	let card: MirrorCard | null = null;
	if (merged.cardNumber.validated && merged.name.collapsed) {
		try {
			card = await lookupCard(
				game,
				merged.cardNumber.validated,
				merged.name.collapsed,
				lookupParallel
			);
		} catch (err) {
			console.debug('[tier1-canonical] lookupCard failed', err);
		}
	}
	if (!card && merged.cardNumber.validated) {
		try {
			card = await lookupCardByCardNumberFuzzy(
				game,
				merged.cardNumber.validated,
				merged.name.raw || merged.name.collapsed || '',
				lookupParallel
			);
		} catch (err) {
			console.debug('[tier1-canonical] fuzzy lookup failed', err);
		}
	}

	// BoBA parallel comes from cards.parallel (prefix-derived source of truth).
	// Wonders parallel comes from the classifier (already mapped to human name).
	let parallel: string | null = null;
	if (game === 'boba' && card) {
		parallel = card.parallel ?? 'Paper';
	} else if (game === 'wonders') {
		parallel = parallelHumanName;
	}

	// Phase 1 Doc 1.0 — Catalog cross-validation gate.
	// We always compute the result; the *gate* (whether validation forces
	// fallback) is enforced by the caller in recognition-tiers.ts so we
	// can keep this function pure / testable.
	let validation: { passed: boolean; reason: string | null } | null = null;
	try {
		const validationFlagOn = await (async () => {
			try {
				const m = await import('$lib/stores/feature-flags.svelte');
				return m.featureEnabled('phase1_catalog_validation_v1')();
			} catch { return false; }
		})();
		if (validationFlagOn) {
			const { validateCatalogTriangulation } = await import('./catalog-validation');
			const r = validateCatalogTriangulation({
				game,
				ocrCardNumber: merged.cardNumber.validated,
				ocrName: merged.name.collapsed,
				ocrParallel: parallelHumanName,
				candidateCard: card
			});
			validation = r.passed
				? { passed: true, reason: null }
				: { passed: false, reason: r.reason };
		}
	} catch (err) {
		console.debug('[tier1-canonical] validation skipped', err);
	}

	// Close the 180°-retry bitmap if we created one. Owned by this fn.
	if (rotatedRetryBitmap) {
		try { rotatedRetryBitmap.close(); } catch { /* ignore */ }
	}

	return {
		card,
		cardNumber: merged.cardNumber.validated,
		name: merged.name.collapsed,
		parallel,
		confidence: Math.min(merged.cardNumber.confidence, merged.name.confidence),
		ocrStrategy: strategy,
		validation,
		ocrRegionBatchSize: merged.ocrRegionBatchSize ?? null,
		ocrRegionTotalMs: merged.ocrRegionTotalMs ?? null,
		perTask: {
			cardNumber: merged.cardNumber,
			name: merged.name,
			...(parallelPerTask ? { parallel: parallelPerTask } : {}),
			...(merged.setCode ? { setCode: merged.setCode } : {})
		}
	};
}

async function runRegionOCR(
	bitmap: ImageBitmap,
	game: 'boba' | 'wonders'
): Promise<OCROutputs> {
	const regions = game === 'boba' ? REGIONS.boba : REGIONS.wonders;
	const cardNumberReg = regionToPixels(regions.card_number, bitmap.width, bitmap.height);
	const nameReg = regionToPixels(
		game === 'boba' ? REGIONS.boba.hero_name : REGIONS.wonders.card_name,
		bitmap.width,
		bitmap.height
	);
	// BoBA's bottom-left "2026" year stamp lives below the card_number.
	// Wonders has no equivalent ROI — leave setCodeReg null and the
	// downstream task vote is skipped.
	const setCodeReg =
		game === 'boba'
			? regionToPixels(REGIONS.boba.set_code, bitmap.width, bitmap.height)
			: null;

	// Doc 2, Phase 4 — rec-only path. We KNOW where each field lives on the
	// rectified canonical, so skip PaddleOCR's text-detection model on each
	// sub-ROI and feed the rec head directly. Falls back to ocrRegion inside
	// ocrRecOnly when the standalone Recognition didn't initialize.
	//   - card_number target ~56px: 3mm chars on canonical ≈ 36px, upsampled
	//     for the rec head's preferred ~48px training height.
	//   - name target ~64px: 5mm chars on canonical ≈ 60px, near identity.
	//   - set_code target 48px: small year stamp; rec head's natural size.
	// Phase 2 Doc 2.4 — batched call when flag on. The batched path returns
	// results in input order (matching the per-region indexing below) and
	// throws on failure → caller catch falls back to serial path.
	const batchedEnabled = featureEnabled('phase2_batched_recognition_v1')();
	const regionInputs: Array<{
		region: { x: number; y: number; w: number; h: number };
		targetHeight: number;
	}> = [
		{ region: cardNumberReg, targetHeight: 56 },
		{ region: nameReg, targetHeight: 64 }
	];
	if (setCodeReg) {
		regionInputs.push({ region: setCodeReg, targetHeight: 48 });
	}

	let numRes: PromiseSettledResult<OCRResult>;
	let nameRes: PromiseSettledResult<OCRResult>;
	let setRes: PromiseSettledResult<OCRResult>;
	let regionBatchSize: number | null = null;
	let regionBatchMs: number | null = null;

	if (batchedEnabled) {
		const tBatchStart = performance.now();
		try {
			const batched = await ocrRecOnlyBatch(bitmap, regionInputs);
			regionBatchMs = Math.round(performance.now() - tBatchStart);
			regionBatchSize = regionInputs.length;
			numRes = { status: 'fulfilled', value: batched[0] };
			nameRes = { status: 'fulfilled', value: batched[1] };
			setRes = setCodeReg
				? { status: 'fulfilled', value: batched[2] }
				: { status: 'fulfilled', value: { text: '', confidence: 0, boxes: [] } };
		} catch (err) {
			console.debug('[tier1-canonical] batched recognition threw, falling back to serial', err);
			// Serial fallback path — same call shape as pre-Doc-2.4.
			[numRes, nameRes, setRes] = await Promise.allSettled([
				ocrRecOnly(bitmap, cardNumberReg, { targetHeight: 56 }),
				ocrRecOnly(bitmap, nameReg, { targetHeight: 64 }),
				setCodeReg
					? ocrRecOnly(bitmap, setCodeReg, { targetHeight: 48 })
					: Promise.resolve({ text: '', confidence: 0, boxes: [] })
			]);
			regionBatchMs = Math.round(performance.now() - tBatchStart);
			regionBatchSize = null; // explicitly NULL — serial fallback after batch failure
		}
	} else {
		const tSerialStart = performance.now();
		[numRes, nameRes, setRes] = await Promise.allSettled([
			ocrRecOnly(bitmap, cardNumberReg, { targetHeight: 56 }),
			ocrRecOnly(bitmap, nameReg, { targetHeight: 64 }),
			setCodeReg
				? ocrRecOnly(bitmap, setCodeReg, { targetHeight: 48 })
				: Promise.resolve({ text: '', confidence: 0, boxes: [] })
		]);
		regionBatchMs = Math.round(performance.now() - tSerialStart);
		// regionBatchSize stays null when flag off — distinguishes the cohorts.
	}

	// Phase 1 Doc 1.2 — canonical path is single-frame, so it cannot
	// produce 2 votes for any task. Switch to single-vote acceptance with
	// a 0.6 per-vote confidence floor (PaddleOCR's typical floor for
	// readable text under good lighting).
	const builder = new ConsensusBuilder(1, game, {
		singleVoteAcceptance: true,
		minSummedConfidence: 0.6
	});
	if (numRes.status === 'fulfilled') {
		// card_number regions usually return a single box; pickTopBox is a
		// no-op there. Kept for symmetry with the name path.
		const top = pickTopBox(numRes.value.boxes);
		if (top?.text) {
			builder.addVote({
				task: 'card_number',
				rawValue: top.text,
				confidence: top.score || numRes.value.confidence,
				sessionId: 1
			});
		}
	}
	if (nameRes.status === 'fulfilled') {
		// Hero name is always the top line; edition/subtitle stamps below
		// it ("FIRST EDITION", "WORLD CHAMPIONS DEBUT", future variants)
		// are correctly excluded by taking the top-Y box only.
		const top = pickTopBox(nameRes.value.boxes);
		if (top?.text) {
			builder.addVote({
				task: 'name',
				rawValue: top.text,
				confidence: top.score || nameRes.value.confidence,
				sessionId: 1
			});
		}
	}
	if (setCodeReg && setRes.status === 'fulfilled') {
		const top = pickTopBox(setRes.value.boxes);
		if (top?.text) {
			builder.addVote({
				task: 'set_code',
				rawValue: top.text,
				confidence: top.score || setRes.value.confidence,
				sessionId: 1
			});
		}
	}
	const consensus = builder.getConsensus();

	const numTop = numRes.status === 'fulfilled' ? pickTopBox(numRes.value.boxes) : null;
	const nameTop = nameRes.status === 'fulfilled' ? pickTopBox(nameRes.value.boxes) : null;
	const setTop =
		setCodeReg && setRes.status === 'fulfilled' ? pickTopBox(setRes.value.boxes) : null;

	const out: OCROutputs = {
		cardNumber: {
			raw: numTop?.text || (numRes.status === 'fulfilled' ? numRes.value.text : ''),
			confidence:
				numTop?.score || (numRes.status === 'fulfilled' ? numRes.value.confidence : 0),
			validated: consensus.cardNumber?.value || null
		},
		name: {
			raw: nameTop?.text || (nameRes.status === 'fulfilled' ? nameRes.value.text : ''),
			confidence:
				nameTop?.score || (nameRes.status === 'fulfilled' ? nameRes.value.confidence : 0),
			collapsed: consensus.name?.value || null
		},
		// Phase 2 Doc 2.4 — propagate to CanonicalResult for scan-writer.
		ocrRegionBatchSize: regionBatchSize,
		ocrRegionTotalMs: regionBatchMs
	};
	if (setCodeReg) {
		out.setCode = {
			raw: setTop?.text || (setRes.status === 'fulfilled' ? setRes.value.text : ''),
			confidence:
				setTop?.score || (setRes.status === 'fulfilled' ? setRes.value.confidence : 0),
			value: consensus.setCode?.value || null
		};
	}
	return out;
}

/**
 * Expand a normalized region by `pad` (0–1) on each side, clamped to [0,1].
 * Used to widen the spatial gate for full-frame OCR voting so we tolerate
 * region-coord drift without letting card-body text bleed in.
 */
function expandRegion(
	r: { x: number; y: number; w: number; h: number },
	pad: number
): { x: number; y: number; w: number; h: number } {
	const padW = r.w * pad;
	const padH = r.h * pad;
	const x = Math.max(0, r.x - padW);
	const y = Math.max(0, r.y - padH);
	const w = Math.min(1 - x, r.w + 2 * padW);
	const h = Math.min(1 - y, r.h + 2 * padH);
	return { x, y, w, h };
}

/**
 * Full-frame OCR pattern-extraction. Validated 100% accuracy on 20 real
 * phone-photographed cards at 2400px long edge. Each detected box is tried
 * as both a card_number and a name vote — ConsensusBuilder's prefix
 * validation and catalog-shortlist collapse pick the right box for each.
 */
async function runFullFrameOCR(
	bitmap: ImageBitmap,
	game: 'boba' | 'wonders'
): Promise<OCROutputs> {
	const result = await ocrFullFrame(bitmap, { maxLongEdge: 2400 });

	// Spatial gating — only vote a detected box for a task if its centroid
	// falls inside the (padded) configured region for that task. Without
	// this, rules text from the card body gets fed into card_number voting,
	// and the validator's pattern is the only thing standing between us
	// and false matches. With this, full-frame OCR is a strict superset of
	// region OCR — it just sweeps in nearby boxes that pure region cropping
	// might have missed because of region-coord drift.
	const cnRegion = expandRegion(
		game === 'boba' ? REGIONS.boba.card_number : REGIONS.wonders.card_number,
		0.5
	);
	const nmRegion = expandRegion(
		game === 'boba' ? REGIONS.boba.hero_name : REGIONS.wonders.card_name,
		0.5
	);

	const builder = new ConsensusBuilder(1, game, {
		singleVoteAcceptance: true,
		minSummedConfidence: 0.6
	});
	for (const box of result.boxes) {
		if (!box.text) continue;
		const center = boxCenterNormalized(box.box, bitmap.width, bitmap.height);
		if (!center) continue;
		if (regionContains(cnRegion, center)) {
			builder.addVote({
				task: 'card_number',
				rawValue: box.text,
				confidence: box.score,
				sessionId: 1
			});
		}
		if (regionContains(nmRegion, center)) {
			builder.addVote({
				task: 'name',
				rawValue: box.text,
				confidence: box.score,
				sessionId: 1
			});
		}
	}
	const consensus = builder.getConsensus();

	const cnBox = consensus.cardNumber
		? result.boxes.find((b) => consensus.cardNumber!.rawVotes.includes(b.text))
		: null;
	const nmBox = consensus.name
		? result.boxes.find((b) => consensus.name!.rawVotes.includes(b.text))
		: null;

	return {
		cardNumber: {
			raw: cnBox?.text || '',
			confidence: cnBox?.score || 0,
			validated: consensus.cardNumber?.value || null
		},
		name: {
			raw: nmBox?.text || '',
			confidence: nmBox?.score || 0,
			collapsed: consensus.name?.value || null
		}
	};
}

function mergeOCROutputs(region: OCROutputs, full: OCROutputs): OCROutputs {
	const merged: OCROutputs = {
		cardNumber: pickField(region.cardNumber, full.cardNumber, 'validated'),
		name: pickField(region.name, full.name, 'collapsed'),
		// Phase 2 Doc 2.4 — preserve region-path batching telemetry.
		ocrRegionBatchSize: region.ocrRegionBatchSize ?? null,
		ocrRegionTotalMs: region.ocrRegionTotalMs ?? null
	};
	// set_code only ever comes from the region path (BoBA-only sub-ROI;
	// full-frame OCR doesn't vote on it). Pass it through unchanged.
	if (region.setCode) merged.setCode = region.setCode;
	return merged;
}

function pickField<T extends { confidence: number }>(
	region: T,
	full: T,
	key: keyof T
): T {
	const rOk = !!region[key];
	const fOk = !!full[key];
	if (rOk && !fOk) return region;
	if (!rOk && fOk) return full;
	if (!rOk && !fOk) return region;
	return region.confidence >= full.confidence ? region : full;
}

async function safeClassifyParallel(
	bitmap: ImageBitmap
): Promise<Awaited<ReturnType<typeof classifyWondersParallel>> | null> {
	try {
		return await classifyWondersParallel(bitmap);
	} catch (err) {
		console.debug('[tier1-canonical] parallel classifier failed', err);
		return null;
	}
}
