/**
 * Playbook allocator — combinatorial assignment of plays across multiple
 * tournament formats given DBS caps. Lifted out of playbook-engine.ts;
 * deck/play analysis (DBS scoring, draw probability, archetype matching,
 * combo detection) stays in playbook-engine.
 *
 * Both functions operate on the same input shape; allocateForTwoTournaments
 * is a specialization of allocateForMultipleTournaments preserved for
 * legacy callers (it has tighter bounds and a slightly different output).
 */

import { PLAYBOOK_ARCHETYPES } from '$lib/data/playbook-archetypes';
import { categorizePlay } from '$lib/data/play-categories';
import type { FormatRules } from '$lib/data/tournament-formats';
import type { PlayCard } from './playbook-engine';

// ── Multi-Tournament Deck Allocation ────────────────────────

export interface DeckAllocation {
	deck1: PlayCard[];
	deck2: PlayCard[];
	deck1Score: number;
	deck2Score: number;
	combinedScore: number;
}

export function allocateForTwoTournaments(
	ownedPlays: PlayCard[],
	format1: FormatRules,
	archetype1Id: string,
	format2: FormatRules,
	archetype2Id: string
): DeckAllocation {
	const result = allocateForMultipleTournaments(ownedPlays, [
		{ formatId: format1.id, archetypeId: archetype1Id, format: format1 },
		{ formatId: format2.id, archetypeId: archetype2Id, format: format2 }
	]);

	return {
		deck1: result.decks[0]?.plays || [],
		deck2: result.decks[1]?.plays || [],
		deck1Score: result.decks[0]?.archetypeMatchScore || 0,
		deck2Score: result.decks[1]?.archetypeMatchScore || 0,
		combinedScore: result.utilization.used
	};
}

// ── Enhanced Multi-Tournament Allocation ────────────────────

export interface TournamentEntry {
	formatId: string;
	archetypeId: string;
	format: FormatRules;
	/** Pre-assigned plays the Coach has already locked in */
	lockedPlays?: PlayCard[];
}

export interface MultiDeckAllocation {
	decks: AllocatedDeck[];
	unallocated: PlayCard[];
	contested: ContestedPlay[];
	utilization: { used: number; total: number };
}

export interface AllocatedDeck {
	entryIndex: number;
	formatId: string;
	archetypeId: string;
	plays: PlayCard[];
	dbsTotal: number;
	dbsRemaining: number;
	archetypeMatchScore: number;
	weakCategories: Array<{ categoryId: string; have: number; recommended: number }>;
}

export interface ContestedPlay {
	play: PlayCard;
	wantedBy: Array<{ entryIndex: number; priorityScore: number }>;
	painCost: Record<number, number>;
	assignedTo: number;
}

/**
 * Check if a play card is legal for a given format's card pool.
 */
function isPlayLegalForFormat(play: PlayCard, format: FormatRules): boolean {
	switch (format.cardPool) {
		case 'alpha_trilogy':
			return ['A', 'U'].includes(play.release);
		case 'tecmo_only':
			return play.release === 'T';
		case 'blast_only':
			return play.release === 'B';
		case 'all_in_rotation':
		case 'modern':
		default:
			return true;
	}
}

/**
 * Score a play against an archetype. Higher = more important for that archetype.
 */
function scorePlayForArchetype(play: PlayCard, archetypeId: string): number {
	const arch = PLAYBOOK_ARCHETYPES.find((a) => a.id === archetypeId);
	if (!arch) return 0;

	const cats = categorizePlay(play);
	let score = 0;
	for (const cat of cats) {
		const alloc = arch.categoryAllocation[cat];
		if (alloc) score += alloc.priority;
	}
	return score;
}

/**
 * Allocate plays across 2-3+ tournament entries.
 *
 * Uses a 4-pass algorithm:
 *   1. Format-exclusive: assign plays only legal in one format
 *   2. Archetype-exclusive: assign plays strongly preferred by one archetype
 *   3. Contention resolution: marginal value with diminishing returns
 *   4. DBS optimization: fill remaining slots with low-DBS utility plays
 */
export function allocateForMultipleTournaments(
	ownedPlays: PlayCard[],
	entries: TournamentEntry[]
): MultiDeckAllocation {
	const n = entries.length;
	const eligible = ownedPlays.filter((p) => p.type === 'PL' || p.type === 'BPL');

	// Initialize deck state
	const deckPlays: PlayCard[][] = entries.map(() => []);
	const deckDbs: number[] = entries.map(() => 0);
	const assigned = new Set<string>(); // play IDs already assigned
	const contested: ContestedPlay[] = [];

	// Pre-assign locked plays
	for (let i = 0; i < n; i++) {
		const locked = entries[i].lockedPlays || [];
		for (const play of locked) {
			if (!assigned.has(play.id)) {
				deckPlays[i].push(play);
				deckDbs[i] += play.dbs;
				assigned.add(play.id);
			}
		}
	}

	// Helper: can a play be added to a specific deck?
	function canAdd(play: PlayCard, entryIdx: number): boolean {
		const fmt = entries[entryIdx].format;
		const cap = fmt.dbsCap;
		const size = fmt.playDeckSize;
		return (
			deckPlays[entryIdx].length < size &&
			(cap === null || deckDbs[entryIdx] + play.dbs <= cap) &&
			isPlayLegalForFormat(play, fmt)
		);
	}

	// Pass 1: Format-exclusive assignment
	for (const play of eligible) {
		if (assigned.has(play.id)) continue;
		const legalIn: number[] = [];
		for (let i = 0; i < n; i++) {
			if (isPlayLegalForFormat(play, entries[i].format) && canAdd(play, i)) {
				legalIn.push(i);
			}
		}
		if (legalIn.length === 1) {
			const idx = legalIn[0];
			deckPlays[idx].push(play);
			deckDbs[idx] += play.dbs;
			assigned.add(play.id);
		}
	}

	// Pass 2: Archetype-exclusive assignment
	for (const play of eligible) {
		if (assigned.has(play.id)) continue;
		const scores = entries.map((e, i) => ({
			idx: i,
			score: canAdd(play, i) ? scorePlayForArchetype(play, e.archetypeId) : 0
		}));
		const nonZero = scores.filter((s) => s.score > 0);

		if (nonZero.length === 1) {
			const idx = nonZero[0].idx;
			deckPlays[idx].push(play);
			deckDbs[idx] += play.dbs;
			assigned.add(play.id);
		}
	}

	// Track category counts per deck for diminishing returns
	const categoryCounts: Record<string, number>[] = entries.map(() => ({}));
	for (let i = 0; i < n; i++) {
		for (const play of deckPlays[i]) {
			const cats = categorizePlay(play);
			for (const cat of cats) {
				categoryCounts[i][cat] = (categoryCounts[i][cat] || 0) + 1;
			}
		}
	}

	// Pass 3: Contention resolution with marginal value
	const remaining = eligible.filter((p) => !assigned.has(p.id));
	const scoredRemaining = remaining.map((play) => {
		const entryScores = entries.map((e, i) => {
			if (!canAdd(play, i)) return { idx: i, score: 0, marginal: 0 };
			const base = scorePlayForArchetype(play, e.archetypeId);
			const cats = categorizePlay(play);
			// Diminishing returns: each additional card in the same category worth less
			let diminishing = 0;
			for (const cat of cats) {
				const existing = categoryCounts[i][cat] || 0;
				diminishing += 1 / (1 + existing);
			}
			const marginal = base * (diminishing / Math.max(1, cats.length));
			return { idx: i, score: base, marginal };
		});

		entryScores.sort((a, b) => b.marginal - a.marginal);
		return { play, entryScores };
	});

	// Sort by contention: plays with small diff between top 2 decks are most contested
	scoredRemaining.sort((a, b) => {
		const aDiff = (a.entryScores[0]?.marginal || 0) - (a.entryScores[1]?.marginal || 0);
		const bDiff = (b.entryScores[0]?.marginal || 0) - (b.entryScores[1]?.marginal || 0);
		// Assign least-contested first (biggest diff)
		return bDiff - aDiff;
	});

	for (const { play, entryScores } of scoredRemaining) {
		const valid = entryScores.filter((s) => s.marginal > 0 && canAdd(play, s.idx));
		if (valid.length === 0) continue;

		const winner = valid[0];
		deckPlays[winner.idx].push(play);
		deckDbs[winner.idx] += play.dbs;
		assigned.add(play.id);

		// Update category counts
		const cats = categorizePlay(play);
		for (const cat of cats) {
			categoryCounts[winner.idx][cat] = (categoryCounts[winner.idx][cat] || 0) + 1;
		}

		// Track contested plays (wanted by 2+ decks)
		if (valid.length >= 2) {
			const wantedBy = valid.map((v) => ({ entryIndex: v.idx, priorityScore: v.marginal }));
			const painCost: Record<number, number> = {};
			for (const v of valid) {
				if (v.idx !== winner.idx) {
					painCost[v.idx] = v.marginal;
				}
			}
			painCost[winner.idx] = valid[1]?.marginal || 0;

			contested.push({
				play,
				wantedBy,
				painCost,
				assignedTo: winner.idx
			});
		}
	}

	// Pass 4: DBS optimization — fill remaining slots with unallocated plays
	const stillUnassigned = eligible.filter((p) => !assigned.has(p.id));
	for (let i = 0; i < n; i++) {
		const fmt = entries[i].format;
		if (deckPlays[i].length >= fmt.playDeckSize) continue;

		const fillers = stillUnassigned
			.filter((p) => canAdd(p, i) && !assigned.has(p.id))
			.sort((a, b) => a.dbs - b.dbs); // Prefer low-DBS utility plays

		for (const play of fillers) {
			if (deckPlays[i].length >= fmt.playDeckSize) break;
			if (assigned.has(play.id)) continue;
			deckPlays[i].push(play);
			deckDbs[i] += play.dbs;
			assigned.add(play.id);
		}
	}

	// Build result
	const decks: AllocatedDeck[] = entries.map((entry, i) => {
		const fmt = entry.format;
		const arch = PLAYBOOK_ARCHETYPES.find((a) => a.id === entry.archetypeId);
		const dbsTotal = deckDbs[i];
		const dbsRemaining = fmt.dbsCap !== null ? Math.max(0, fmt.dbsCap - dbsTotal) : Infinity;

		// Calculate archetype match score
		let matchScore = 0;
		let maxScore = 0;
		const weakCategories: AllocatedDeck['weakCategories'] = [];

		if (arch) {
			for (const [catId, alloc] of Object.entries(arch.categoryAllocation)) {
				const have = categoryCounts[i][catId] || 0;
				const catScore = Math.min(have / alloc.min, 1) * alloc.priority;
				matchScore += catScore;
				maxScore += alloc.priority;
				if (have < alloc.min) {
					weakCategories.push({ categoryId: catId, have, recommended: alloc.min });
				}
			}
		}

		return {
			entryIndex: i,
			formatId: entry.formatId,
			archetypeId: entry.archetypeId,
			plays: deckPlays[i],
			dbsTotal,
			dbsRemaining,
			archetypeMatchScore: maxScore > 0 ? Math.round((matchScore / maxScore) * 100) : 0,
			weakCategories
		};
	});

	// Sort contested by total pain (highest first)
	contested.sort((a, b) => {
		const totalPainA = Object.values(a.painCost).reduce((s, v) => s + v, 0);
		const totalPainB = Object.values(b.painCost).reduce((s, v) => s + v, 0);
		return totalPainB - totalPainA;
	});

	const unallocated = eligible.filter((p) => !assigned.has(p.id));

	return {
		decks,
		unallocated,
		contested,
		utilization: { used: assigned.size, total: eligible.length }
	};
}
