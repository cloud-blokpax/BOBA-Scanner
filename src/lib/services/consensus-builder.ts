/**
 * Per-session vote tallying for live OCR Tier 1.
 *
 * Each scan cycle emits votes (card_number, name, parallel). Votes are
 * validated against the catalog-mirror shortlists (prefix matching,
 * Levenshtein-collapse to known names) and tallied. Consensus is reached
 * when agreement count + summed confidence clear the thresholds.
 */

import {
	getBobaPrefixes,
	getBobaHeroes,
	getWondersNames
} from './catalog-mirror';
import { normalizeOcrName, levenshtein } from '$lib/utils/normalize-ocr-name';

export type TaskKind = 'card_number' | 'name' | 'parallel';

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

export interface Consensus {
	sessionId: number;
	reachedThreshold: boolean;
	cardNumber: TaskConsensus | null;
	name: TaskConsensus | null;
	parallel: TaskConsensus | null;
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

export class ConsensusBuilder {
	private sessionId: number;
	private game: 'boba' | 'wonders';
	private cardNumberVotes: Map<string, Bucket>;
	private nameVotes: Map<string, Bucket>;
	private parallelVotes: Map<string, Bucket>;
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
		this.cardNumberVotes = new Map();
		this.nameVotes = new Map();
		this.parallelVotes = new Map();
		this.minAgreement = config.minAgreement ?? DEFAULT_MIN_AGREEMENT;
		this.minSummedConfidence = config.minSummedConfidence ?? DEFAULT_MIN_SUMMED_CONFIDENCE;
	}

	addVote(vote: Vote): void {
		if (vote.sessionId !== this.sessionId) return; // stale, drop

		if (vote.task === 'card_number') {
			const validated = this.validateCardNumber(vote.rawValue);
			if (validated) this.tally(this.cardNumberVotes, validated, vote);
		} else if (vote.task === 'name') {
			const collapsed = this.collapseName(vote.rawValue);
			if (collapsed) this.tally(this.nameVotes, collapsed, vote);
		} else if (vote.task === 'parallel') {
			this.tally(this.parallelVotes, vote.rawValue, vote);
		}
	}

	tickFrame(): void {
		this.frameCount++;
	}

	private tally(map: Map<string, Bucket>, key: string, vote: Vote): void {
		const existing = map.get(key) || { count: 0, totalConf: 0, raw: [] };
		existing.count++;
		existing.totalConf += vote.confidence;
		existing.raw.push(vote.rawValue);
		map.set(key, existing);
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
					if (!prefixes.has(prefixMatch[1])) return null;
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
		if (best && best.dist <= Math.max(2, Math.floor(best.name.length * 0.15))) return best.name;
		return null;
	}

	getConsensus(): Consensus {
		const pick = (m: Map<string, Bucket>): TaskConsensus | null => {
			let best: { key: string; count: number; conf: number; raw: string[] } | null = null;
			for (const [k, v] of m) {
				if (
					!best ||
					v.count > best.count ||
					(v.count === best.count && v.totalConf > best.conf)
				) {
					best = { key: k, count: v.count, conf: v.totalConf, raw: v.raw };
				}
			}
			if (!best) return null;
			return {
				value: best.key,
				agreementCount: best.count,
				summedConfidence: best.conf,
				votesSeen: Array.from(m.values()).reduce((a, v) => a + v.count, 0),
				rawVotes: best.raw
			};
		};

		const cn = pick(this.cardNumberVotes);
		const nm = pick(this.nameVotes);
		const pr = pick(this.parallelVotes);

		const textReached = (t: TaskConsensus | null) =>
			!!t &&
			t.agreementCount >= this.minAgreement &&
			t.summedConfidence >= this.minSummedConfidence;
		const parallelReached = (t: TaskConsensus | null) =>
			!!t && t.agreementCount >= this.minAgreement;

		// Parallel is only required for Wonders. BoBA's parallel is baked into
		// card_number via prefix; the classifier doesn't run there.
		const parallelRequired = this.game === 'wonders';
		const reachedThreshold =
			textReached(cn) && textReached(nm) && (!parallelRequired || parallelReached(pr));

		return {
			sessionId: this.sessionId,
			reachedThreshold,
			cardNumber: cn,
			name: nm,
			parallel: pr,
			frameCount: this.frameCount
		};
	}
}

