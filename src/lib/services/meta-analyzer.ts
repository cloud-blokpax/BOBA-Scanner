/**
 * Anti-Meta Analyzer
 *
 * Aggregates tournament deck submission data into meta trends.
 * Recommends counter-builds based on the current meta landscape.
 *
 * All computation is client-side — no API cost for analysis.
 */

import { COMBO_ENGINES } from '$lib/data/combo-engines';
import { getArchetype } from '$lib/data/playbook-archetypes';

// ── Types ───────────────────────────────────────────────────

export interface DeckSubmissionData {
	submissionId: string;
	formatId: string;
	tournamentId: string;
	tournamentName?: string;
	eventDate?: string;
	/** Placement: 1 = winner, null = unknown */
	placement: number | null;
	wins: number;
	losses: number;
	heroes: Array<{
		card_number: string;
		hero_name: string;
		power: number;
		weapon_type: string;
		parallel?: string;
	}>;
	plays: Array<{
		card_number: string;
		name: string;
		dbs_score: number;
	}>;
}

export interface MetaSnapshot {
	formatId: string;
	sampleSize: number;
	dateRange: { from: string; to: string };
	cardInclusionRates: CardInclusionEntry[];
	weaponDistribution: Record<string, { count: number; percent: number }>;
	archetypeBreakdown: ArchetypePopularity[];
	comboFrequency: ComboFrequencyEntry[];
	dbsStats: { avg: number; median: number; min: number; max: number };
	powerStats: { avgTotal: number; avgPerHero: number; avgMax: number };
	topPerformers: TopPerformerEntry[];
}

export interface CardInclusionEntry {
	cardNumber: string;
	name: string;
	inclusionRate: number;
	count: number;
	dbs: number;
	winRate: number | null;
}

export interface ArchetypePopularity {
	archetypeId: string;
	name: string;
	prevalence: number;
	count: number;
	avgWinRate: number | null;
}

export interface ComboFrequencyEntry {
	engineId: string;
	name: string;
	completeRate: number;
	partialRate: number;
}

export interface TopPerformerEntry {
	cardNumber: string;
	name: string;
	inclusionRate: number;
	winRateDelta: number;
	impactScore: number;
}

// ── Meta Snapshot Builder ───────────────────────────────────

export function buildMetaSnapshot(
	submissions: DeckSubmissionData[],
	formatId: string
): MetaSnapshot {
	const formatDecks = submissions.filter((s) => s.formatId === formatId);
	const n = formatDecks.length;

	if (n === 0) return emptySnapshot(formatId);

	// ── Card Inclusion Rates ──────────────────────────────
	const cardCounts = new Map<
		string,
		{ name: string; count: number; dbs: number; wins: number; games: number }
	>();

	for (const deck of formatDecks) {
		const deckGames = deck.wins + deck.losses;

		for (const play of deck.plays) {
			const key = play.card_number;
			const existing = cardCounts.get(key) || {
				name: play.name,
				count: 0,
				dbs: play.dbs_score,
				wins: 0,
				games: 0
			};
			existing.count++;
			if (deckGames > 0) {
				existing.wins += deck.wins;
				existing.games += deckGames;
			}
			cardCounts.set(key, existing);
		}
	}

	const cardInclusionRates: CardInclusionEntry[] = Array.from(cardCounts.entries())
		.map(([cardNumber, data]) => ({
			cardNumber,
			name: data.name,
			inclusionRate: data.count / n,
			count: data.count,
			dbs: data.dbs,
			winRate: data.games > 0 ? data.wins / data.games : null
		}))
		.sort((a, b) => b.inclusionRate - a.inclusionRate);

	// ── Weapon Distribution ───────────────────────────────
	const weaponTotals: Record<string, number> = {};
	let totalHeroes = 0;

	for (const deck of formatDecks) {
		for (const hero of deck.heroes) {
			const wt = (hero.weapon_type || 'unknown').toLowerCase();
			weaponTotals[wt] = (weaponTotals[wt] || 0) + 1;
			totalHeroes++;
		}
	}

	const weaponDistribution: Record<string, { count: number; percent: number }> = {};
	for (const [weapon, count] of Object.entries(weaponTotals)) {
		weaponDistribution[weapon] = {
			count,
			percent: totalHeroes > 0 ? count / totalHeroes : 0
		};
	}

	// ── Archetype Matching ────────────────────────────────
	const archetypeCounts: Record<string, { count: number; wins: number; games: number }> = {};

	for (const deck of formatDecks) {
		const deckWeapons: Record<string, number> = {};
		for (const hero of deck.heroes) {
			const wt = (hero.weapon_type || 'unknown').toLowerCase();
			deckWeapons[wt] = (deckWeapons[wt] || 0) + 1;
		}

		const heroCount = deck.heroes.length;
		const dominantWeapon = Object.entries(deckWeapons).sort((a, b) => b[1] - a[1])[0];
		const dominantPercent = dominantWeapon && heroCount > 0 ? dominantWeapon[1] / heroCount : 0;

		// Simple archetype classification
		let matchedArchetype = 'mixed';
		if (dominantPercent >= 0.65 && dominantWeapon) {
			matchedArchetype = `mono_${dominantWeapon[0]}_fortress`;
		}

		// Check for free play density
		const freePlays = deck.plays.filter((p) => p.dbs_score <= 5).length;
		if (freePlays >= 15) matchedArchetype = 'free_play_engine';

		if (!archetypeCounts[matchedArchetype]) {
			archetypeCounts[matchedArchetype] = { count: 0, wins: 0, games: 0 };
		}
		archetypeCounts[matchedArchetype].count++;
		archetypeCounts[matchedArchetype].wins += deck.wins;
		archetypeCounts[matchedArchetype].games += deck.wins + deck.losses;
	}

	const archetypeBreakdown: ArchetypePopularity[] = Object.entries(archetypeCounts)
		.map(([id, data]) => {
			const arch = getArchetype(id);
			return {
				archetypeId: id,
				name: arch?.name || id.replace(/_/g, ' '),
				prevalence: data.count / n,
				count: data.count,
				avgWinRate: data.games > 0 ? data.wins / data.games : null
			};
		})
		.sort((a, b) => b.prevalence - a.prevalence);

	// ── Combo Engine Frequency ────────────────────────────
	const comboFrequency: ComboFrequencyEntry[] = COMBO_ENGINES.filter(
		(e) => e.coreCards.length > 0
	)
		.map((engine) => {
			let completeCount = 0;
			let partialCount = 0;

			for (const deck of formatDecks) {
				const deckPlayNames = new Set(deck.plays.map((p) => p.name));
				const coreHits = engine.coreCards.filter((c) => deckPlayNames.has(c)).length;

				if (coreHits === engine.coreCards.length) completeCount++;
				else if (coreHits >= 2) partialCount++;
			}

			return {
				engineId: engine.id,
				name: engine.name,
				completeRate: completeCount / n,
				partialRate: partialCount / n
			};
		})
		.sort((a, b) => b.completeRate - a.completeRate);

	// ── DBS Stats ─────────────────────────────────────────
	const dbsTotals = formatDecks
		.map((d) => d.plays.reduce((s, p) => s + p.dbs_score, 0))
		.sort((a, b) => a - b);

	const mid = Math.floor(n / 2);
	const dbsMedian = n % 2 === 1 ? dbsTotals[mid] : (dbsTotals[mid - 1] + dbsTotals[mid]) / 2;

	const dbsStats = {
		avg: dbsTotals.reduce((s, v) => s + v, 0) / n,
		median: dbsMedian,
		min: dbsTotals[0],
		max: dbsTotals[n - 1]
	};

	// ── Power Stats ───────────────────────────────────────
	const powerTotals = formatDecks.map((d) => d.heroes.reduce((s, h) => s + h.power, 0));
	const maxPowers = formatDecks.map((d) =>
		d.heroes.length > 0 ? Math.max(...d.heroes.map((h) => h.power)) : 0
	);

	const powerStats = {
		avgTotal: powerTotals.reduce((s, v) => s + v, 0) / n,
		avgPerHero: totalHeroes > 0 ? powerTotals.reduce((s, v) => s + v, 0) / totalHeroes : 0,
		avgMax: maxPowers.reduce((s, v) => s + v, 0) / n
	};

	// ── Top Performers ────────────────────────────────────
	const overallWinRate =
		formatDecks.reduce((s, d) => s + d.wins, 0) /
		Math.max(1, formatDecks.reduce((s, d) => s + d.wins + d.losses, 0));

	const minSample = Math.max(3, Math.ceil(n * 0.1));
	const topPerformers: TopPerformerEntry[] = cardInclusionRates
		.filter((c) => c.winRate !== null && c.count >= minSample)
		.map((c) => ({
			cardNumber: c.cardNumber,
			name: c.name,
			inclusionRate: c.inclusionRate,
			winRateDelta: (c.winRate || 0) - overallWinRate,
			impactScore: c.inclusionRate * ((c.winRate || 0) - overallWinRate)
		}))
		.sort((a, b) => b.impactScore - a.impactScore);

	// ── Date Range ────────────────────────────────────────
	const dates = formatDecks
		.map((d) => d.eventDate)
		.filter((d): d is string => !!d)
		.sort();

	return {
		formatId,
		sampleSize: n,
		dateRange: { from: dates[0] || '', to: dates[dates.length - 1] || '' },
		cardInclusionRates,
		weaponDistribution,
		archetypeBreakdown,
		comboFrequency,
		dbsStats,
		powerStats,
		topPerformers
	};
}

// ── Counter-Build Recommendations ───────────────────────────

export interface CounterRecommendation {
	metaTrend: string;
	counterStrategy: string;
	recommendedCards: string[];
	cardsToAvoid: string[];
	suggestedArchetype: string | null;
	confidence: 'low' | 'medium' | 'high';
}

function confidenceFromSampleSize(n: number): 'low' | 'medium' | 'high' {
	if (n >= 20) return 'high';
	if (n >= 8) return 'medium';
	return 'low';
}

export function generateCounterRecommendations(
	meta: MetaSnapshot
): CounterRecommendation[] {
	const recs: CounterRecommendation[] = [];
	const n = meta.sampleSize;
	if (n === 0) return recs;

	// ── Counter: Dominant weapon type ─────────────────────
	const topWeapon = Object.entries(meta.weaponDistribution).sort(
		(a, b) => b[1].percent - a[1].percent
	)[0];

	if (topWeapon && topWeapon[1].percent > 0.35) {
		recs.push({
			metaTrend: `${Math.round(topWeapon[1].percent * 100)}% of heroes are ${topWeapon[0]} weapon`,
			counterStrategy: `Weapon Alchemy converts all heroes to ${topWeapon[0]}, then your anti-${topWeapon[0]} plays fire every battle. Alternatively, run weapon-agnostic plays to ignore their weapon synergy entirely.`,
			recommendedCards:
				topWeapon[0] === 'steel'
					? ['Only Steel', 'Molten Steel', 'Rusted Edge']
					: ['Only Steel'],
			cardsToAvoid: [],
			suggestedArchetype:
				topWeapon[0] === 'steel' ? 'weapon_alchemy' : 'free_play_engine',
			confidence: confidenceFromSampleSize(n)
		});
	}

	// ── Counter: High combo engine prevalence ─────────────
	for (const combo of meta.comboFrequency) {
		if (combo.completeRate > 0.2) {
			const engine = COMBO_ENGINES.find((e) => e.id === combo.engineId);
			if (engine) {
				recs.push({
					metaTrend: `${Math.round(combo.completeRate * 100)}% of decks run the complete ${engine.name}`,
					counterStrategy:
						engine.risk === 'high'
							? 'This engine requires specific sequencing — play denial in early battles disrupts the setup.'
							: 'Nullify the persistent effects with cards that return plays to hand (Rule 5.1.7 — ongoing effects are killed when a play leaves the zone).',
					recommendedCards:
						engine.id === 'dice_engine'
							? ['Full Court Press', 'Flame Wall', 'Steel Defense']
							: [],
					cardsToAvoid: [],
					suggestedArchetype: null,
					confidence: confidenceFromSampleSize(n)
				});
			}
		}
	}

	// ── Counter: Low recovery meta (vulnerable to HD denial) ─
	const recoveryInclusion = meta.cardInclusionRates
		.filter(
			(c) =>
				c.name.toLowerCase().includes('recover') ||
				c.name.toLowerCase().includes('refund')
		)
		.reduce((s, c) => s + c.inclusionRate, 0);

	if (recoveryInclusion < 0.3) {
		recs.push({
			metaTrend: `Most decks run few recovery plays — average recovery card inclusion is ${Math.round(recoveryInclusion * 100)}%`,
			counterStrategy:
				"The meta is vulnerable to hot dog denial. Drought + Bun Shortage + Ultimatum Dog will starve opponents who haven't planned for resource scarcity.",
			recommendedCards: ['Bun Shortage', 'Drought', 'Ultimatum Dog', 'Dog Gone Inflation'],
			cardsToAvoid: [],
			suggestedArchetype: 'starvation',
			confidence: n >= 15 ? 'high' : 'medium'
		});
	}

	// ── Counter: Comeback-heavy meta ──────────────────────
	const comebackCards = ['Turn the Tide', 'Comeback Time', 'To Fight Another Day', 'Saving Bullets'];
	const comebackInclusion = comebackCards.reduce((sum, cardName) => {
		const found = meta.cardInclusionRates.find((c) => c.name === cardName);
		return sum + (found?.inclusionRate || 0);
	}, 0) / comebackCards.length;

	if (comebackInclusion > 0.15) {
		recs.push({
			metaTrend: `${Math.round(comebackInclusion * 100)}% average inclusion of comeback cards — opponents are sandbagging early battles`,
			counterStrategy:
				"Don't give them the 0-3 start they want. Persistent buffs in Battle 1-2 (Noble Sacrifice, weapon boosts) make your early heroes strong enough to force a split. If they can't cleanly lose 3, the comeback math falls apart.",
			recommendedCards: ['Noble Sacrifice', 'Member Bounce', 'The 12th Man'],
			cardsToAvoid: ['Turn the Tide', 'Comeback Time'],
			suggestedArchetype: 'noble_sacrifice_stack',
			confidence: n >= 15 ? 'high' : 'medium'
		});
	}

	return recs;
}

function emptySnapshot(formatId: string): MetaSnapshot {
	return {
		formatId,
		sampleSize: 0,
		dateRange: { from: '', to: '' },
		cardInclusionRates: [],
		weaponDistribution: {},
		archetypeBreakdown: [],
		comboFrequency: [],
		dbsStats: { avg: 0, median: 0, min: 0, max: 0 },
		powerStats: { avgTotal: 0, avgPerHero: 0, avgMax: 0 },
		topPerformers: []
	};
}
