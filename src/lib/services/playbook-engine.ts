/**
 * Playbook Engine — Pure Computation Functions
 *
 * Provides all analysis capabilities for the Playbook Architect:
 * - DBS budget analysis
 * - Hot dog flow projection across 7 battles
 * - Draw probability calculations (hypergeometric)
 * - Combo detection against the engine registry
 * - Strategic category classification and scoring
 * - Hero weapon composition recommendation
 * - Bonus play dilution analysis
 * - Multi-tournament deck allocation
 *
 * All functions are stateless and side-effect-free.
 */

import { COMBO_ENGINES, type ComboEngine } from '$lib/data/combo-engines';
import { PLAY_CATEGORIES, categorizePlay } from '$lib/data/play-categories';
import { PLAYBOOK_ARCHETYPES, type PlaybookArchetype } from '$lib/data/playbook-archetypes';
import type { FormatRules } from '$lib/data/tournament-formats';

// ── Types ───────────────────────────────────────────────────

export interface PlayCard {
	id: string;
	card_number: string;
	name: string;
	release: string;
	type: 'PL' | 'BPL' | 'HTD';
	number: number;
	hot_dog_cost: number;
	dbs: number;
	ability: string;
}

export interface DBSAnalysis {
	total: number;
	cap: number | null;
	remaining: number;
	percentUsed: number;
	isOverCap: boolean;
	avgPerSlot: number;
	filledSlots: number;
	totalSlots: number;
}

export interface HDFlowProjection {
	/** HD at the start of each battle (array of 7) */
	hdPerBattle: number[];
	/** Expected plays activated per battle */
	playsPerBattle: number[];
	/** Expected substitutions */
	totalSubstitutions: number;
	/** Total plays activated across the game */
	totalActivations: number;
	/** HD remaining at end of game */
	hdEndOfGame: number;
	/** Battle number where HD first hits 0, or null */
	runsOutAt: number | null;
}

export interface DrawProbabilityAnalysis {
	/** For each category: probability of drawing at least 1 in opening hand */
	categoryDrawRates: Record<
		string,
		{
			count: number;
			probInOpening4: number;
			probInFirst8: number;
		}
	>;
	/** Probability of drawing at least 1 draw-play in opening hand */
	drawPlayInOpening: number;
	/** Expected total plays seen in a game */
	expectedPlaysSeen: number;
}

export interface ComboDetectionResult {
	/** Combos where all core cards are present */
	complete: Array<{ engine: ComboEngine; enhancersPresent: string[] }>;
	/** Combos where some but not all core cards are present */
	partial: Array<{ engine: ComboEngine; present: string[]; missing: string[] }>;
	/** Combos where no core cards are present */
	absent: ComboEngine[];
}

export interface ArchetypeMatchResult {
	archetype: PlaybookArchetype;
	/** 0-100 score for how well the player's collection fits this archetype */
	matchScore: number;
	/** Which category allocations are satisfied vs. missing */
	categoryFit: Record<string, { have: number; need: number; satisfied: boolean }>;
	/** Missing plays that would most improve the match */
	topMissingPlays: Array<{ play: PlayCard; impact: string }>;
}

export interface HeroRecommendation {
	primaryWeapon: string | null;
	primaryCount: number;
	secondaryWeapon: string | null;
	secondaryCount: number;
	reasoning: string;
	weaponPlayCounts: Record<string, number>;
}

export interface BonusPlayEvaluation {
	play: PlayCard;
	/** Net strategic value after accounting for dilution */
	netValue: number;
	/** Raw power contribution estimate */
	rawImpact: number;
	/** Dilution cost */
	dilutionCost: number;
	/** Recommendation */
	verdict: 'add' | 'marginal' | 'skip';
}

// ── DBS Analysis ────────────────────────────────────────────

export function analyzeDBS(selectedPlays: PlayCard[], format: FormatRules): DBSAnalysis {
	const total = selectedPlays.reduce((sum, p) => sum + p.dbs, 0);
	const cap = format.dbsCap;
	const totalSlots =
		format.playDeckSize + (format.bonusPlaysAllowed ? format.maxBonusPlays : 0);
	const filledSlots = selectedPlays.length;
	const remaining = cap !== null ? cap - total : Infinity;
	const emptySlots = totalSlots - filledSlots;

	return {
		total,
		cap,
		remaining: cap !== null ? Math.max(0, remaining) : Infinity,
		percentUsed: cap !== null ? Math.min(100, Math.round((total / cap) * 100)) : 0,
		isOverCap: cap !== null && total > cap,
		avgPerSlot: emptySlots > 0 && cap !== null ? Math.round(remaining / emptySlots) : 0,
		filledSlots,
		totalSlots
	};
}

// ── Hot Dog Flow Projection ─────────────────────────────────

export function projectHDFlow(
	selectedPlays: PlayCard[],
	heroWeaponConcentration: number
): HDFlowProjection {
	const freePlays = selectedPlays.filter((p) => p.hot_dog_cost === 0);
	const paidPlays = selectedPlays.filter((p) => p.hot_dog_cost > 0);
	const avgPaidCost =
		paidPlays.length > 0
			? paidPlays.reduce((sum, p) => sum + p.hot_dog_cost, 0) / paidPlays.length
			: 0;

	// Estimate recovery per game from recovery plays
	const recoveryPlays = selectedPlays.filter((p) => /recover.*hot dog/i.test(p.ability));
	const expectedRecoveryPlaysSeen = recoveryPlays.length * 0.3;
	const expectedRecoveryHD = expectedRecoveryPlaysSeen * 2;

	const hasBonusRecovery = selectedPlays.some((p) => p.name === 'Bonus Recovery');

	// Substitutions needed based on weapon concentration
	const weaponMatchSubs =
		heroWeaponConcentration > 0.75 ? 0.5 : heroWeaponConcentration > 0.5 ? 1.5 : 2.5;

	const hdPerBattle: number[] = [];
	const playsPerBattle: number[] = [];
	let hd = 10;
	let totalActivations = 0;
	let runsOutAt: number | null = null;

	// Distribute recovery across battles (weighted toward mid-game)
	const recoveryPerBattle = [
		0,
		0,
		expectedRecoveryHD * 0.2,
		expectedRecoveryHD * 0.3,
		expectedRecoveryHD * 0.3,
		expectedRecoveryHD * 0.2,
		0
	];

	for (let battle = 0; battle < 7; battle++) {
		// Substitution cost
		const ceilSubs = Math.ceil(weaponMatchSubs);
		const subCostThisBattle =
			ceilSubs > 0 && battle < ceilSubs
				? Math.min(2, (weaponMatchSubs * 2) / ceilSubs)
				: 0;
		hd = Math.max(0, hd - subCostThisBattle);

		// Recovery
		hd +=
			(recoveryPerBattle[battle] || 0) +
			(hasBonusRecovery && recoveryPerBattle[battle] > 0 ? 1 : 0);

		// Play activation
		const freeRatio = freePlays.length / Math.max(1, selectedPlays.length);
		let activationsThisBattle = 0;

		if (freeRatio > 0.3) {
			activationsThisBattle = 1;
		}
		if (hd >= avgPaidCost && avgPaidCost > 0 && paidPlays.length > 0) {
			activationsThisBattle += 1;
			hd -= avgPaidCost;
		}

		hdPerBattle.push(Math.max(0, Math.round(hd * 10) / 10));
		playsPerBattle.push(activationsThisBattle);
		totalActivations += activationsThisBattle;

		if (hd <= 0 && runsOutAt === null) {
			runsOutAt = battle + 1;
		}
	}

	return {
		hdPerBattle,
		playsPerBattle,
		totalSubstitutions: weaponMatchSubs,
		totalActivations,
		hdEndOfGame: Math.max(0, Math.round(hd * 10) / 10),
		runsOutAt
	};
}

// ── Draw Probability (Hypergeometric) ───────────────────────

/**
 * P(X >= 1) = 1 - C(N-K, n) / C(N, n)
 * Uses logarithms to avoid overflow with large factorials.
 */
function probAtLeastOne(deckSize: number, cardsOfType: number, handSize: number): number {
	if (cardsOfType <= 0) return 0;
	if (cardsOfType >= deckSize) return 1;
	if (deckSize - cardsOfType < handSize) return 1;

	let logProbNone = 0;
	for (let i = 0; i < handSize; i++) {
		logProbNone += Math.log(deckSize - cardsOfType - i) - Math.log(deckSize - i);
	}
	return 1 - Math.exp(logProbNone);
}

export function analyzeDrawProbability(
	selectedPlays: PlayCard[],
	deckSize: number
): DrawProbabilityAnalysis {
	const openingHandSize = 4;

	// Categorize all selected plays
	const playCats: Record<string, PlayCard[]> = {};
	for (const play of selectedPlays) {
		const cats = categorizePlay(play);
		for (const cat of cats) {
			if (!playCats[cat]) playCats[cat] = [];
			playCats[cat].push(play);
		}
	}

	// Estimate expected plays seen in a game
	const drawPlays = playCats['draw_play'] || [];
	const expectedDrawPlaysSeen =
		drawPlays.length * (openingHandSize / deckSize) * 7 * 0.5;
	const expectedExtraDraws = expectedDrawPlaysSeen * 1.5;
	const expectedPlaysSeen = Math.min(deckSize, openingHandSize + expectedExtraDraws);
	const first8 = Math.min(deckSize, Math.round(expectedPlaysSeen));

	const categoryDrawRates: Record<
		string,
		{ count: number; probInOpening4: number; probInFirst8: number }
	> = {};
	for (const cat of PLAY_CATEGORIES) {
		const count = (playCats[cat.id] || []).length;
		categoryDrawRates[cat.id] = {
			count,
			probInOpening4: probAtLeastOne(deckSize, count, openingHandSize),
			probInFirst8: probAtLeastOne(deckSize, count, first8)
		};
	}

	return {
		categoryDrawRates,
		drawPlayInOpening: probAtLeastOne(deckSize, drawPlays.length, openingHandSize),
		expectedPlaysSeen
	};
}

// ── Combo Detection ─────────────────────────────────────────

export function detectCombos(selectedPlays: PlayCard[]): ComboDetectionResult {
	const playNames = new Set(selectedPlays.map((p) => p.name));
	const result: ComboDetectionResult = { complete: [], partial: [], absent: [] };

	for (const engine of COMBO_ENGINES) {
		// Skip engines with no defined core cards (TBD engines)
		if (engine.coreCards.length === 0) {
			result.absent.push(engine);
			continue;
		}

		const present = engine.coreCards.filter((name) => playNames.has(name));
		const missing = engine.coreCards.filter((name) => !playNames.has(name));
		const enhancersPresent = engine.enhancerCards.filter((name) => playNames.has(name));

		if (missing.length === 0) {
			result.complete.push({ engine, enhancersPresent });
		} else if (present.length > 0) {
			result.partial.push({ engine, present, missing });
		} else {
			result.absent.push(engine);
		}
	}

	return result;
}

// ── Hero Weapon Recommendation ──────────────────────────────

export function recommendHeroes(selectedPlays: PlayCard[]): HeroRecommendation {
	const weaponPlayCounts: Record<string, number> = {
		steel: 0,
		fire: 0,
		ice: 0,
		glow: 0,
		hex: 0,
		gum: 0,
		super: 0,
		brawl: 0
	};

	for (const play of selectedPlays) {
		const cats = categorizePlay(play);
		if (cats.includes('weapon_steel')) weaponPlayCounts.steel++;
		if (cats.includes('weapon_fire')) weaponPlayCounts.fire++;
		if (cats.includes('weapon_ice')) weaponPlayCounts.ice++;
		if (/glow/i.test(play.ability)) weaponPlayCounts.glow++;
		if (/hex/i.test(play.ability) && /your hero/i.test(play.ability)) weaponPlayCounts.hex++;
		if (/gum/i.test(play.ability) && /your hero/i.test(play.ability)) weaponPlayCounts.gum++;
		if (/super/i.test(play.ability) && /your hero/i.test(play.ability))
			weaponPlayCounts.super++;
	}

	const sorted = Object.entries(weaponPlayCounts).sort((a, b) => b[1] - a[1]);
	const topWeapon = sorted[0];
	const secondWeapon = sorted[1] ?? [null, 0] as [string | null, number];

	if (!topWeapon || topWeapon[1] < 3) {
		return {
			primaryWeapon: null,
			primaryCount: 0,
			secondaryWeapon: null,
			secondaryCount: 0,
			reasoning: `Your playbook has ${topWeapon?.[1] ?? 0} weapon-specific plays — not enough to commit to a weapon. Run the highest-power heroes available across all weapon types. All 10 HD can go to substitutions for power optimization.`,
			weaponPlayCounts
		};
	}

	const primaryCount = topWeapon[1] >= 8 ? 50 : topWeapon[1] >= 5 ? 42 : 35;
	const secondaryCount = secondWeapon[1] >= 3 ? 60 - primaryCount : 0;

	return {
		primaryWeapon: topWeapon[0],
		primaryCount,
		secondaryWeapon: secondWeapon[1] >= 3 ? secondWeapon[0] : null,
		secondaryCount,
		reasoning: `Your playbook has ${topWeapon[1]} ${topWeapon[0]}-specific plays. At ${primaryCount}/60 ${topWeapon[0]} heroes, these plays fire in ${((7 * primaryCount) / 60).toFixed(1)} of 7 battles on average, and you need roughly ${primaryCount >= 42 ? '0-1' : '1-2'} weapon-matching substitutions per game.`,
		weaponPlayCounts
	};
}

// ── Archetype Matching ──────────────────────────────────────

export function matchArchetypes(
	ownedPlays: PlayCard[],
	format: FormatRules
): ArchetypeMatchResult[] {
	const results: ArchetypeMatchResult[] = [];

	// Categorize all owned plays
	const ownedByCategory: Record<string, PlayCard[]> = {};
	for (const play of ownedPlays) {
		const cats = categorizePlay(play);
		for (const cat of cats) {
			if (!ownedByCategory[cat]) ownedByCategory[cat] = [];
			ownedByCategory[cat].push(play);
		}
	}

	for (const archetype of PLAYBOOK_ARCHETYPES) {
		if (
			archetype.bestFormats.length > 0 &&
			!archetype.bestFormats.includes(format.id)
		) {
			continue;
		}

		let totalScore = 0;
		let maxPossibleScore = 0;
		const categoryFit: Record<string, { have: number; need: number; satisfied: boolean }> =
			{};

		for (const [catId, allocation] of Object.entries(archetype.categoryAllocation)) {
			const owned = (ownedByCategory[catId] || []).length;
			const need = allocation.min;
			const satisfied = owned >= need;
			const catScore = Math.min(owned / need, 1) * allocation.priority;

			categoryFit[catId] = { have: owned, need, satisfied };
			totalScore += catScore;
			maxPossibleScore += allocation.priority;
		}

		const matchScore =
			maxPossibleScore > 0 ? Math.round((totalScore / maxPossibleScore) * 100) : 0;

		results.push({
			archetype,
			matchScore,
			categoryFit,
			topMissingPlays: []
		});
	}

	results.sort((a, b) => b.matchScore - a.matchScore);
	return results;
}

// ── Bonus Play Dilution Analysis ────────────────────────────

export function evaluateBonusPlays(
	currentDeck: PlayCard[],
	availableBonusPlays: PlayCard[],
	deckSize: number
): BonusPlayEvaluation[] {
	const evaluations: BonusPlayEvaluation[] = [];

	const avgCurrentImpact =
		currentDeck.reduce((sum, p) => {
			const match = p.ability.match(/\+(\d+)/);
			return sum + (match ? parseInt(match[1]) : 10);
		}, 0) / Math.max(1, currentDeck.length);

	for (const bpl of availableBonusPlays) {
		const powerMatch = bpl.ability.match(/\+(\d+)/);
		const rawImpact = powerMatch ? parseInt(powerMatch[1]) : 10;

		const persistentMultiplier = /rest of the game/i.test(bpl.ability) ? 3 : 1;
		const adjustedImpact = rawImpact * persistentMultiplier;

		const currentProb = 1 / deckSize;
		const newProb = 1 / (deckSize + 1);
		const probLossPerCard = currentProb - newProb;
		const totalDilutionCost = probLossPerCard * currentDeck.length * avgCurrentImpact;

		const netValue = adjustedImpact - totalDilutionCost;

		evaluations.push({
			play: bpl,
			netValue: Math.round(netValue * 10) / 10,
			rawImpact: adjustedImpact,
			dilutionCost: Math.round(totalDilutionCost * 10) / 10,
			verdict: netValue > 5 ? 'add' : netValue > -2 ? 'marginal' : 'skip'
		});
	}

	evaluations.sort((a, b) => b.netValue - a.netValue);
	return evaluations;
}

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
 *   4. DBS optimization: fill remaining slots with efficient unallocated plays
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
