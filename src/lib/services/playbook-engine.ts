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
		const subCostThisBattle =
			battle < Math.ceil(weaponMatchSubs)
				? Math.min(2, (weaponMatchSubs * 2) / Math.ceil(weaponMatchSubs))
				: 0;
		hd -= subCostThisBattle;

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
		if (hd >= avgPaidCost && paidPlays.length > 0) {
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
	const secondWeapon = sorted[1];

	if (topWeapon[1] < 3) {
		return {
			primaryWeapon: null,
			primaryCount: 0,
			secondaryWeapon: null,
			secondaryCount: 0,
			reasoning: `Your playbook has ${topWeapon[1]} weapon-specific plays — not enough to commit to a weapon. Run the highest-power heroes available across all weapon types. All 10 HD can go to substitutions for power optimization.`,
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
	const arch1 = PLAYBOOK_ARCHETYPES.find((a) => a.id === archetype1Id);
	const arch2 = PLAYBOOK_ARCHETYPES.find((a) => a.id === archetype2Id);

	const deck1: PlayCard[] = [];
	const deck2: PlayCard[] = [];
	let dbs1 = 0;
	let dbs2 = 0;

	const scored = ownedPlays
		.filter((p) => p.type === 'PL' || p.type === 'BPL')
		.map((play) => {
			const cats = categorizePlay(play);
			let score1 = 0;
			let score2 = 0;

			if (arch1) {
				for (const cat of cats) {
					const alloc = arch1.categoryAllocation[cat];
					if (alloc) score1 += alloc.priority;
				}
			}
			if (arch2) {
				for (const cat of cats) {
					const alloc = arch2.categoryAllocation[cat];
					if (alloc) score2 += alloc.priority;
				}
			}

			return { play, score1, score2, diff: score1 - score2 };
		});

	// Assign the most "opinionated" plays first
	scored.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

	for (const { play, score1, score2 } of scored) {
		const cap1 = format1.dbsCap;
		const cap2 = format2.dbsCap;
		const size1 = format1.playDeckSize;
		const size2 = format2.playDeckSize;

		const canAddToDeck1 =
			deck1.length < size1 && (cap1 === null || dbs1 + play.dbs <= cap1);
		const canAddToDeck2 =
			deck2.length < size2 && (cap2 === null || dbs2 + play.dbs <= cap2);

		if (canAddToDeck1 && canAddToDeck2) {
			if (score1 >= score2) {
				deck1.push(play);
				dbs1 += play.dbs;
			} else {
				deck2.push(play);
				dbs2 += play.dbs;
			}
		} else if (canAddToDeck1) {
			deck1.push(play);
			dbs1 += play.dbs;
		} else if (canAddToDeck2) {
			deck2.push(play);
			dbs2 += play.dbs;
		}
	}

	return {
		deck1,
		deck2,
		deck1Score: deck1.reduce(
			(s, p) => s + (categorizePlay(p).length > 0 ? 1 : 0),
			0
		),
		deck2Score: deck2.reduce(
			(s, p) => s + (categorizePlay(p).length > 0 ? 1 : 0),
			0
		),
		combinedScore: deck1.length + deck2.length
	};
}
