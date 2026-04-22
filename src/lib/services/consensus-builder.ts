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
	getWondersNames,
	normalizeOcrName
} from './catalog-mirror';

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

const MIN_AGREEMENT = 2;
const MIN_SUMMED_CONFIDENCE = 1.5;

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

	constructor(sessionId: number, game: 'boba' | 'wonders') {
		this.sessionId = sessionId;
		this.game = game;
		this.cardNumberVotes = new Map();
		this.nameVotes = new Map();
		this.parallelVotes = new Map();
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
		const cleaned = raw.toUpperCase().replace(/[^A-Z0-9/-]/g, '').trim();
		if (!cleaned) return null;
		const prefixMatch = cleaned.match(/^([A-Z]+)-/);
		if (prefixMatch) {
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
		if (/^\d+(\/\d+)?$/.test(cleaned) || /^[A-Z]+\d+/.test(cleaned)) return cleaned;
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
			!!t && t.agreementCount >= MIN_AGREEMENT && t.summedConfidence >= MIN_SUMMED_CONFIDENCE;
		const parallelReached = (t: TaskConsensus | null) =>
			!!t && t.agreementCount >= MIN_AGREEMENT;

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

function levenshtein(a: string, b: string): number {
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const m: number[][] = [];
	for (let i = 0; i <= b.length; i++) m[i] = [i];
	for (let j = 0; j <= a.length; j++) m[0][j] = j;
	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			const cost = a[j - 1] === b[i - 1] ? 0 : 1;
			m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
		}
	}
	return m[b.length][a.length];
}
