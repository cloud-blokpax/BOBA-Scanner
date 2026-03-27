/**
 * Dead Card Detector
 *
 * Analyzes weapon alignment between a Coach's playbook and hero deck.
 * Surfaces plays that will rarely activate due to insufficient weapon density.
 *
 * The most common deckbuilding mistake new Coaches make is including
 * weapon-specific plays without enough matching heroes. This module
 * cross-references every weapon-specific play against the hero deck's
 * weapon distribution and provides per-play activation rates.
 */

import { PLAY_CATEGORIES, categorizePlay } from '$lib/data/play-categories';
import type { Card } from '$lib/types';
import type { PlayCard } from './playbook-engine';

// ── Types ───────────────────────────────────────────────────

export interface DeadCardReport {
	/** Per-play alignment analysis */
	plays: PlayAlignmentScore[];
	/** Aggregate: how many plays are misaligned */
	deadCardCount: number;
	/** Aggregate: DBS "wasted" on misaligned plays */
	wastedDBS: number;
	/** Per-weapon summary */
	weaponSummary: WeaponAlignmentSummary[];
}

export interface PlayAlignmentScore {
	play: PlayCard;
	/** The weapon type this play requires, or null if weapon-agnostic */
	requiredWeapon: string | null;
	/** Number of heroes in the deck with this weapon */
	heroCount: number;
	/** Expected battles where this play can fire (out of 7) */
	expectedActiveBattles: number;
	/** Probability of at least 1 matching hero in 7 zones + expected subs */
	activationRate: number;
	/** Green >= 0.70, Yellow 0.40-0.69, Red < 0.40 */
	rating: 'green' | 'yellow' | 'red';
	/** Human-readable explanation */
	explanation: string;
}

export interface WeaponAlignmentSummary {
	weapon: string;
	heroCount: number;
	heroPercent: number;
	playCount: number;
	/** Average activation rate across all plays requiring this weapon */
	avgActivationRate: number;
	rating: 'green' | 'yellow' | 'red';
}

/**
 * Map from play-categories.ts weapon category IDs to weapon type keys.
 * Extend this as new weapon categories are added.
 */
const WEAPON_CATEGORY_MAP: Record<string, string> = {
	weapon_steel: 'steel',
	weapon_fire: 'fire',
	weapon_ice: 'ice'
};

/**
 * Detect which weapon a play requires by analyzing its categories
 * and ability text. Returns null for weapon-agnostic plays.
 */
function detectRequiredWeapon(play: PlayCard): string | null {
	// First: check via play-categories.ts pattern matching
	const cats = categorizePlay(play);
	for (const [catId, weapon] of Object.entries(WEAPON_CATEGORY_MAP)) {
		if (cats.includes(catId)) return weapon;
	}

	// Fallback: regex scan ability text for weapon mentions
	const weaponPatterns: Record<string, RegExp> = {
		steel: /steel\s*weapon/i,
		fire: /fire\s*weapon/i,
		ice: /ice\s*weapon/i,
		brawl: /brawl\s*weapon/i,
		glow: /glow\s*weapon/i,
		hex: /hex\s*weapon/i,
		gum: /gum\s*weapon/i
	};

	for (const [weapon, pattern] of Object.entries(weaponPatterns)) {
		if (pattern.test(play.ability)) return weapon;
	}

	// Name-based heuristic for plays with empty ability text:
	// Plays whose names contain a weapon keyword are likely weapon-specific
	const nameWeaponPatterns: Record<string, RegExp> = {
		steel: /\bsteel\b/i,
		fire: /\b(?:fire|flame|blaze|scorch|molten|inferno)\b/i,
		ice: /\b(?:ice|frost|frozen|cold|blizzard)\b/i,
		glow: /\bglow\b/i,
		hex: /\bhex\b/i,
		gum: /\bgum\b/i,
		brawl: /\bbrawl\b/i
	};

	for (const [weapon, pattern] of Object.entries(nameWeaponPatterns)) {
		if (pattern.test(play.name)) return weapon;
	}

	return null;
}

/**
 * Calculate activation rate for a weapon-specific play.
 *
 * @param weaponCount - Heroes with the required weapon type
 * @param totalHeroes - Total heroes in the deck (usually 60)
 * @param expectedSubs - Expected substitutions per game (archetype-dependent)
 */
function calculateActivationRate(
	weaponCount: number,
	totalHeroes: number,
	expectedSubs: number = 1
): { expectedBattles: number; activationRate: number } {
	if (totalHeroes === 0) return { expectedBattles: 0, activationRate: 0 };

	// Expected battles with a matching hero in the zone
	const expectedBattles = 7 * (weaponCount / totalHeroes);

	// Probability of at least 1 matching hero across 7 zones + subs
	const draws = 7 + expectedSubs;
	const missRate = Math.max(0, (totalHeroes - weaponCount) / totalHeroes);
	const activationRate = 1 - Math.pow(missRate, draws);

	return { expectedBattles, activationRate };
}

function rateActivation(activationRate: number): 'green' | 'yellow' | 'red' {
	if (activationRate >= 0.7) return 'green';
	if (activationRate >= 0.4) return 'yellow';
	return 'red';
}

/**
 * Analyze a deck for dead cards.
 *
 * @param playbook - The Coach's selected play cards
 * @param heroDeck - The Coach's hero cards
 * @param expectedSubs - Expected substitutions per game (default 1)
 */
export function analyzeDeadCards(
	playbook: PlayCard[],
	heroDeck: Card[],
	expectedSubs: number = 1
): DeadCardReport {
	const totalHeroes = heroDeck.length;

	// Count heroes per weapon type
	const weaponCounts: Record<string, number> = {};
	for (const hero of heroDeck) {
		const wt = (hero.weapon_type || 'unknown').toLowerCase();
		weaponCounts[wt] = (weaponCounts[wt] || 0) + 1;
	}

	// Analyze each play
	const plays: PlayAlignmentScore[] = playbook.map((play) => {
		const requiredWeapon = detectRequiredWeapon(play);

		if (!requiredWeapon) {
			return {
				play,
				requiredWeapon: null,
				heroCount: totalHeroes,
				expectedActiveBattles: 7,
				activationRate: 1,
				rating: 'green' as const,
				explanation: 'Weapon-agnostic — fires in every battle'
			};
		}

		const heroCount = weaponCounts[requiredWeapon] || 0;
		const { expectedBattles, activationRate } = calculateActivationRate(
			heroCount,
			totalHeroes,
			expectedSubs
		);

		const rating = rateActivation(activationRate);
		const pct = totalHeroes > 0 ? Math.round((heroCount / totalHeroes) * 100) : 0;

		const explanation =
			heroCount === 0
				? `No ${requiredWeapon} heroes in deck — this play can never fire`
				: `${heroCount} ${requiredWeapon} heroes (${pct}%) — fires in ~${expectedBattles.toFixed(1)} of 7 battles`;

		return {
			play,
			requiredWeapon,
			heroCount,
			expectedActiveBattles: expectedBattles,
			activationRate,
			rating,
			explanation
		};
	});

	// Aggregate stats
	const deadPlays = plays.filter((p) => p.rating === 'red');
	const wastedDBS = deadPlays.reduce((sum, p) => sum + p.play.dbs, 0);

	// Per-weapon summary
	const weaponPlayGroups: Record<string, PlayAlignmentScore[]> = {};
	for (const p of plays) {
		if (p.requiredWeapon) {
			if (!weaponPlayGroups[p.requiredWeapon]) weaponPlayGroups[p.requiredWeapon] = [];
			weaponPlayGroups[p.requiredWeapon].push(p);
		}
	}

	const weaponSummary: WeaponAlignmentSummary[] = Object.entries(weaponPlayGroups).map(
		([weapon, weapPlays]) => {
			const heroCount = weaponCounts[weapon] || 0;
			const avgRate =
				weapPlays.reduce((s, p) => s + p.activationRate, 0) / weapPlays.length;
			return {
				weapon,
				heroCount,
				heroPercent: totalHeroes > 0 ? heroCount / totalHeroes : 0,
				playCount: weapPlays.length,
				avgActivationRate: avgRate,
				rating: rateActivation(avgRate)
			};
		}
	);

	return { plays, deadCardCount: deadPlays.length, wastedDBS, weaponSummary };
}

/**
 * Generate fix suggestions for dead cards.
 * Returns human-readable strings suggesting how to fix the deck.
 */
export function generateFixSuggestions(report: DeadCardReport, totalHeroes: number): string[] {
	const suggestions: string[] = [];

	for (const ws of report.weaponSummary) {
		if (ws.rating === 'red') {
			// How many heroes needed for 70% activation
			const neededFor70 = Math.ceil(totalHeroes * 0.42);
			const heroesNeeded = Math.max(0, neededFor70 - ws.heroCount);
			const dbsFreed = report.plays
				.filter((p) => p.requiredWeapon === ws.weapon && p.rating === 'red')
				.reduce((s, p) => s + p.play.dbs, 0);

			suggestions.push(
				`Add ${heroesNeeded} more ${ws.weapon} heroes to reach ~70% activation, OR remove ${ws.playCount} ${ws.weapon} plays to free ${dbsFreed} DBS.`
			);
		}
	}

	return suggestions;
}
