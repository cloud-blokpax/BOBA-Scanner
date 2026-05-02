/**
 * Per-session vote tallying for live OCR Tier 1.
 *
 * Each scan cycle emits votes (card_number, name, parallel, set_code, …).
 * Votes are validated/canonicalized per-task and tallied into a label-keyed
 * map. Consensus is reached when the required tasks clear their thresholds.
 *
 * Refactor (Doc 2, Phase 7):
 *   - Storage moved from three named maps to a single `Map<task, Tallies>`
 *     so adding a new field (`set_code`, `rarity`, …) is just adding a new
 *     ROI in `ocr-regions.ts` plus a passthrough validator here.
 *   - Existing literal task names ('card_number', 'name', 'parallel') keep
 *     working; live-mode callers don't change.
 *   - Named convenience fields on `Consensus` (cardNumber/name/parallel/setCode)
 *     are projected from the underlying map for API stability.
 */

import {
	getBobaPrefixes,
	getBobaHeroes,
	getWondersNames
} from './catalog-mirror';
import { normalizeOcrName, levenshtein } from '$lib/utils/normalize-ocr-name';
import { correctAgainstVocab } from './vocab-correction';

/**
 * Task label for a vote. Loosened from a fixed union to `string` so new
 * sub-ROIs (set_code, rarity, …) can vote without touching this file.
 * The three legacy literals are still validated/canonicalized specifically;
 * any other task name passes through with a generic uppercase-trim.
 */
export type TaskKind = string;

export interface Vote {
	task: TaskKind;
	rawValue: string;
	confidence: number;
	sessionId: number;
}

export interface TaskConsensus {
	value: string;
	agreementCount: number;
	summedConfidence: number;
	votesSeen: number;
	rawVotes: string[];
}

/**
 * Consensus shape. Named fields preserved for callsite stability — they
 * project from the underlying task→TaskConsensus map for the canonical
 * task names. For new tasks added post-Doc-2, use `getTask(name)` for
 * direct access instead of growing the named-field surface.
 */
export interface Consensus {
	sessionId: number;
	reachedThreshold: boolean;
	cardNumber: TaskConsensus | null;
	name: TaskConsensus | null;
	parallel: TaskConsensus | null;
	setCode: TaskConsensus | null;
	frameCount: number;
}

const DEFAULT_MIN_AGREEMENT = 2;
const DEFAULT_MIN_SUMMED_CONFIDENCE = 1.5;

/**
 * Optional per-call override of the consensus thresholds. Live-scan callers
 * (from 2.1a) omit this and get the permissive defaults (2-of-N, 1.5 summed
 * confidence). Upload-TTA (2.1b) passes tighter values because synthetic
 * frames are correlated and need stronger agreement to trust.
 */
export interface ConsensusBuilderConfig {
	minAgreement?: number;
	minSummedConfidence?: number;
}

interface Bucket {
	count: number;
	totalConf: number;
	raw: string[];
}

interface Tallies {
	byValue: Map<string, Bucket>;
	totalSeen: number;
}

export class ConsensusBuilder {
	private sessionId: number;
	private game: 'boba' | 'wonders';
	private tasks: Map<string, Tallies> = new Map();
	private frameCount = 0;
	private minAgreement: number;
	private minSummedConfidence: number;

	constructor(
		sessionId: number,
		game: 'boba' | 'wonders',
		config: ConsensusBuilderConfig = {}
	) {
		this.sessionId = sessionId;
		this.game = game;
		this.minAgreement = config.minAgreement ?? DEFAULT_MIN_AGREEMENT;
		this.minSummedConfidence = config.minSummedConfidence ?? DEFAULT_MIN_SUMMED_CONFIDENCE;
	}

	addVote(vote: Vote): void {
		if (vote.sessionId !== this.sessionId) return; // stale, drop

		const canonical = this.canonicalize(vote.task, vote.rawValue);
		if (!canonical) return;

		let tallies = this.tasks.get(vote.task);
		if (!tallies) {
			tallies = { byValue: new Map(), totalSeen: 0 };
			this.tasks.set(vote.task, tallies);
		}

		const existing = tallies.byValue.get(canonical) ?? { count: 0, totalConf: 0, raw: [] };
		existing.count++;
		existing.totalConf += vote.confidence;
		existing.raw.push(vote.rawValue);
		tallies.byValue.set(canonical, existing);
		tallies.totalSeen++;
	}

	tickFrame(): void {
		this.frameCount++;
	}

	/**
	 * Per-task validation/canonicalization. Returns the canonical key for
	 * `byValue` storage, or null to drop the vote.
	 *
	 * Three legacy tasks have specific rules; everything else passes through
	 * with a trim+uppercase normalization so new ROIs (set_code, rarity, …)
	 * can vote without touching this file.
	 */
	private canonicalize(task: string, raw: string): string | null {
		if (task === 'card_number') return this.validateCardNumber(raw);
		if (task === 'name') return this.collapseName(raw);
		if (task === 'parallel') return raw && raw.trim() ? raw : null;
		// Generic passthrough — covers set_code and any future informational
		// sub-ROIs. Strip whitespace and uppercase for stable bucketing
		// ("2026", "AVA", etc).
		const cleaned = raw && raw.trim() ? raw.trim().toUpperCase() : null;
		return cleaned || null;
	}

	private validateCardNumber(raw: string): string | null {
		if (!raw || !raw.trim()) return null;

		// Tokenize on whitespace before cleaning. Bottom-strip OCR often
		// returns the card_number alongside set markers / serial prefixes
		// / copyright tags (e.g. "1 316/401 VExis", "0 316/401 Exist"
		// observed in production for Wonders). The actual card_number lives
		// inside; we extract by validating each whitespace-separated token
		// and picking the longest valid result. Single-token reads like
		// "BF-16" still pass through correctly — the array has one element.
		const tokens = raw.split(/\s+/).filter((t) => t.length > 0);
		let best: string | null = null;
		for (const token of tokens) {
			const validated = this.validateCardNumberToken(token);
			if (validated && (!best || validated.length > best.length)) {
				best = validated;
			}
		}
		return best;
	}

	private validateCardNumberToken(rawToken: string): string | null {
		const cleaned = rawToken.toUpperCase().replace(/[^A-Z0-9/-]/g, '').trim();
		if (!cleaned) return null;

		// Length cap — longest real card_number in the catalog is 10 chars
		// ("A1-028/401"). Cap at 12 for headroom. Per-token, this rejects
		// stray prose ("LOOKATTHETOP2CARDSOFTARGETPLAYERS") while letting
		// real card_numbers through.
		if (cleaned.length > 12) return null;

		// Anchored shapes covering 99.99% of the catalog:
		//   "BF-16", "BBF-34", "GLBF-170"   → letters-digits           (15504)
		//   "AVA-T1", "BL-B35", "BL-BG35"   → letters with sub-letters  (1116)
		//   "S-101A"                          → suffix letter             (2)
		//   "S-01/100", "A1-028/401"         → fractional                 (97)
		//   "10", "316"                       → pure digits              (956)
		//   "316/402"                         → fractional digits         (408)
		const PREFIX_PATTERN = /^[A-Z]{1,5}[0-9]?-[A-Z]{0,3}[0-9]{1,4}[A-Z]?(\/[0-9]{1,4})?$/;
		const PURE_DIGIT_PATTERN = /^[0-9]{1,4}(\/[0-9]{1,4})?$/;

		const prefixMatch = cleaned.match(/^([A-Z]+)-/);
		if (prefixMatch) {
			if (!PREFIX_PATTERN.test(cleaned)) return null;
			if (this.game === 'boba') {
				try {
					const prefixes = getBobaPrefixes();
					if (prefixes.has(prefixMatch[1])) {
						return cleaned;
					}
					// Phase 1 Doc 1.1 — single-edit-distance correction against
					// the closed prefix vocabulary. Only accept when exactly
					// one prefix is at distance 1 ("UBF" → "BBF"); ambiguous
					// matches are dropped, preserving the prior reject behavior.
					const corrected = correctAgainstVocab(prefixMatch[1], prefixes);
					if (corrected && corrected.source === 'edit_1') {
						const repaired = cleaned.replace(/^[A-Z]+-/, `${corrected.corrected}-`);
						if (PREFIX_PATTERN.test(repaired)) {
							return repaired;
						}
					}
					return null;
				} catch {
					// Catalog not warmed yet — accept and rely on downstream lookup
				}
			}
			return cleaned;
		}
		if (PURE_DIGIT_PATTERN.test(cleaned)) return cleaned;
		return null;
	}

	/**
	 * Collapse an OCR'd name to the nearest catalog entry.
	 *
	 * Handles the two empirically observed PaddleOCR quirks from Phase 2
	 * validation, by applying `normalizeOcrName` to both sides:
	 *   1. Space-drop in kerned title fonts ("CastOut" ↔ "Cast Out")
	 *   2. 0↔o and 1↔l confusion in small digits inside names ("A-9o" ↔ "A-90")
	 */
	private collapseName(raw: string): string | null {
		let shortlist: string[];
		try {
			shortlist = this.game === 'boba' ? getBobaHeroes() : getWondersNames();
		} catch {
			return null;
		}
		if (!raw.trim()) return null;

		const rawNorm = normalizeOcrName(raw);
		if (!rawNorm) return null;
		let best: { name: string; dist: number } | null = null;
		for (const known of shortlist) {
			const d = levenshtein(rawNorm, normalizeOcrName(known));
			if (!best || d < best.dist) best = { name: known, dist: d };
		}
		// Phase 1 Doc 1.1 — name-length-aware threshold.
		// Floor at 1 for short names (≤6 chars) to avoid accepting wrong
		// neighbors at distance 2; previously max(2, floor(len*0.15)) which
		// was too permissive on short names like "Bojax", "Brawn", "Cicada".
		const threshold = best
			? best.name.length <= 6
				? 1
				: Math.max(2, Math.floor(best.name.length * 0.15))
			: 0;
		if (best && best.dist <= threshold) return best.name;
		return null;
	}

	/**
	 * Direct access to a task's consensus by name. New code adding sub-ROIs
	 * should prefer this over growing the named-field surface on Consensus.
	 */
	getTask(taskName: string): TaskConsensus | null {
		const tallies = this.tasks.get(taskName);
		if (!tallies) return null;
		let best: { key: string; count: number; conf: number; raw: string[] } | null = null;
		for (const [key, bucket] of tallies.byValue) {
			if (
				!best ||
				bucket.count > best.count ||
				(bucket.count === best.count && bucket.totalConf > best.conf)
			) {
				best = { key, count: bucket.count, conf: bucket.totalConf, raw: bucket.raw };
			}
		}
		if (!best) return null;
		return {
			value: best.key,
			agreementCount: best.count,
			summedConfidence: best.conf,
			votesSeen: tallies.totalSeen,
			rawVotes: best.raw
		};
	}

	getConsensus(): Consensus {
		const cn = this.getTask('card_number');
		const nm = this.getTask('name');
		const pr = this.getTask('parallel');
		const sc = this.getTask('set_code');

		const textReached = (t: TaskConsensus | null) =>
			!!t &&
			t.agreementCount >= this.minAgreement &&
			t.summedConfidence >= this.minSummedConfidence;
		const parallelReached = (t: TaskConsensus | null) =>
			!!t && t.agreementCount >= this.minAgreement;

		// Parallel is only required for Wonders. BoBA's parallel is baked into
		// card_number via prefix; the classifier doesn't run there.
		// set_code is informational — it never gates the threshold.
		const parallelRequired = this.game === 'wonders';
		const reachedThreshold =
			textReached(cn) && textReached(nm) && (!parallelRequired || parallelReached(pr));

		return {
			sessionId: this.sessionId,
			reachedThreshold,
			cardNumber: cn,
			name: nm,
			parallel: pr,
			setCode: sc,
			frameCount: this.frameCount
		};
	}
}
