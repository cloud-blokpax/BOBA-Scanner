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

export interface OptimalPlaybookResult {
	/** The chosen plays (standard + bonus) */
	selected: PlayCard[];
	/** Combo engine core cards that aren't available in the universe */
	missing: string[];
	/** Reason annotations per play, keyed by play name */
	rationale: Record<string, string>;
	/** Total DBS used */
	totalDBS: number;
	/** Sum of HD costs */
	totalHD: number;
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

// ── Optimal Playbook Builder ────────────────────────────────

/**
 * Build the ideal 30-card playbook for an archetype from a filtered universe.
 *
 * Algorithm:
 *   1. Seed with combo engine core cards (highest priority — these define the strategy)
 *   2. Walk archetype.categoryAllocation in priority order, filling each category
 *      to its `min` from the universe, picking lowest-DBS plays first within category
 *   3. Top up to playDeckSize with the next-best plays from the universe
 *      (lowest DBS, prefers plays that match any allocated category)
 *   4. If bonusPlayMode allows, add up to 5 (limited) or maxBonusPlays (unlimited)
 *      best bonus plays by netValue from evaluateBonusPlays
 *   5. Stay strictly under format.dbsCap throughout
 *
 * The algorithm prioritizes BREADTH (covering all category mins) over DEPTH
 * (maximizing one category). Users can manually swap individual plays after.
 */
export function buildOptimalPlaybook(
	archetype: PlaybookArchetype,
	universe: PlayCard[],
	format: FormatRules,
	bonusMode: 'off' | 'limited' | 'unlimited' = 'unlimited'
): OptimalPlaybookResult {
	const selected: PlayCard[] = [];
	const missing: string[] = [];
	const rationale: Record<string, string> = {};
	const dbsCap = format.dbsCap ?? Infinity;
	const playDeckSize = format.playDeckSize;
	const maxBonusForMode =
		bonusMode === 'off' ? 0 : bonusMode === 'limited' ? 5 : format.maxBonusPlays;

	const universeByName = new Map(universe.map((p) => [p.name, p]));
	const standardUniverse = universe.filter((p) => p.type === 'PL' || p.type === 'HTD');
	const bonusUniverse = universe.filter((p) => p.type === 'BPL');

	function dbsUsed(): number {
		return selected.reduce((sum, p) => sum + p.dbs, 0);
	}

	function tryAdd(play: PlayCard, reason: string): boolean {
		if (selected.some((s) => s.name === play.name)) return false;
		if (dbsUsed() + play.dbs > dbsCap) return false;
		const isBonus = play.type === 'BPL';
		const standardCount = selected.filter((p) => p.type !== 'BPL').length;
		const bonusCount = selected.filter((p) => p.type === 'BPL').length;
		if (isBonus && bonusCount >= maxBonusForMode) return false;
		if (!isBonus && standardCount >= playDeckSize) return false;
		selected.push(play);
		rationale[play.name] = reason;
		return true;
	}

	// 1. Combo engine cores — highest priority
	for (const engineId of archetype.comboEngines) {
		const engine = COMBO_ENGINES.find((e) => e.id === engineId);
		if (!engine) continue;
		for (const cardName of engine.coreCards) {
			const card = universeByName.get(cardName);
			if (!card) {
				missing.push(cardName);
				continue;
			}
			tryAdd(card, `Core piece of ${engine.name}`);
		}
	}

	// 2. Fill category allocations in priority order
	const allocations = Object.entries(archetype.categoryAllocation).sort(
		(a, b) => a[1].priority - b[1].priority
	);

	for (const [catId, alloc] of allocations) {
		// Candidates: plays in universe matching this category, not already selected,
		// sorted lowest DBS first
		const candidates = standardUniverse
			.filter((p) => !selected.some((s) => s.name === p.name))
			.filter((p) => categorizePlay(p).includes(catId))
			.sort((a, b) => a.dbs - b.dbs);

		const have = selected.filter((p) => categorizePlay(p).includes(catId)).length;
		const need = Math.max(0, alloc.min - have);

		for (let i = 0; i < need && i < candidates.length; i++) {
			tryAdd(candidates[i], `Fills ${catId} (${have + i + 1}/${alloc.min})`);
		}
	}

	// 3. Top up to playDeckSize with lowest-DBS remaining plays.
	//    Prefer plays that match any of the archetype's allocated categories.
	const allocCategoryIds = new Set(Object.keys(archetype.categoryAllocation));
	const topUpCandidates = standardUniverse
		.filter((p) => !selected.some((s) => s.name === p.name))
		.map((p) => {
			const cats = categorizePlay(p);
			const matchesArchetype = cats.some((c) => allocCategoryIds.has(c));
			return { play: p, matchesArchetype };
		})
		.sort((a, b) => {
			if (a.matchesArchetype !== b.matchesArchetype) {
				return a.matchesArchetype ? -1 : 1;
			}
			return a.play.dbs - b.play.dbs;
		});

	for (const { play, matchesArchetype } of topUpCandidates) {
		const standardCount = selected.filter((p) => p.type !== 'BPL').length;
		if (standardCount >= playDeckSize) break;
		tryAdd(
			play,
			matchesArchetype ? 'Strategy fit' : 'Filler (low DBS, broadly useful)'
		);
	}

	// 4. Bonus plays — pick best by netValue, respecting bonus mode cap
	if (maxBonusForMode > 0 && bonusUniverse.length > 0) {
		const standardSelected = selected.filter((p) => p.type !== 'BPL');
		const evals = evaluateBonusPlays(
			standardSelected,
			bonusUniverse,
			standardSelected.length
		);
		for (const ev of evals) {
			if (ev.verdict === 'skip') break;
			tryAdd(ev.play, `Bonus play (net value ${ev.netValue})`);
		}
	}

	return {
		selected,
		missing,
		rationale,
		totalDBS: selected.reduce((sum, p) => sum + p.dbs, 0),
		totalHD: selected.reduce((sum, p) => sum + p.hot_dog_cost, 0)
	};
}

// ── Multi-Tournament Deck Allocation ────────────────────────
//
// Allocator implementations live in playbook-allocator.ts. Re-exported here
// for backward compatibility with existing imports.

export {
	allocateForTwoTournaments,
	allocateForMultipleTournaments
} from './playbook-allocator';
export type {
	DeckAllocation,
	TournamentEntry,
	MultiDeckAllocation,
	AllocatedDeck,
	ContestedPlay
} from './playbook-allocator';

