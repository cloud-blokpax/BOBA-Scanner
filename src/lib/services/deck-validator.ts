/**
 * BoBA Deck Validation Engine
 *
 * Validates a deck of cards against a specific tournament format's rules.
 * Returns detailed violations and deck statistics.
 *
 * Usage:
 *   const result = validateDeck(cards, 'spec_playmaker');
 *   if (!result.isValid) console.log(result.violations);
 */

import { getFormat } from '$lib/data/tournament-formats';
import { getParallel } from '$lib/data/boba-parallels';
import { calculateTotalDbs } from '$lib/data/boba-dbs-scores';
import type { Card } from '$lib/types';

export interface DeckValidationResult {
	isValid: boolean;
	formatId: string;
	formatName: string;
	violations: Violation[];
	warnings: string[];
	stats: DeckStats;
}

export interface Violation {
	rule: string;
	message: string;
	severity: 'error' | 'warning';
	/** Specific cards involved in the violation (for UI highlighting) */
	cardIds?: string[];
}

export interface DeckStats {
	totalHeroes: number;
	totalPower: number;
	averagePower: number;
	maxPower: number;
	minPower: number;
	uniqueVariations: number;
	/** Count of cards per power level */
	powerLevelCounts: Record<number, number>;
	/** Count of cards per weapon type */
	weaponCounts: Record<string, number>;
	/** Count of cards per parallel/insert type */
	parallelCounts: Record<string, number>;
	/** Madness-specific: which insert types have 10+ cards */
	madnessUnlockedInserts: string[];
	/** Madness-specific: total Apex cards allowed */
	madnessTotalApexAllowed: number;
	/** DBS total (null if data unavailable) */
	dbsTotal: number | null;
}

/**
 * Validate a deck against a tournament format's rules.
 *
 * @param heroCards - The Hero cards in the deck
 * @param formatId - The tournament format to validate against
 * @param playCards - Optional: Play cards for DBS validation
 * @param hotDogCards - Optional: Hot Dog cards
 * @returns Detailed validation result
 */
export function validateDeck(
	heroCards: Card[],
	formatId: string,
	playCards: Card[] = [],
	hotDogCards: Card[] = []
): DeckValidationResult {
	const format = getFormat(formatId);
	if (!format) {
		return {
			isValid: false,
			formatId,
			formatName: 'Unknown Format',
			violations: [{ rule: 'format', message: `Unknown format: ${formatId}`, severity: 'error' }],
			warnings: [],
			stats: emptyStats()
		};
	}

	const violations: Violation[] = [];
	const warnings: string[] = [];

	// ── Compute deck statistics ────────────────────────────
	const powers = heroCards.map(c => c.power || 0);
	const totalPower = powers.reduce((sum, p) => sum + p, 0);
	const maxPower = powers.length > 0 ? Math.max(...powers) : 0;
	const minPower = powers.length > 0 ? Math.min(...powers) : 0;

	// Count cards per power level
	const powerLevelCounts: Record<number, number> = {};
	for (const p of powers) {
		powerLevelCounts[p] = (powerLevelCounts[p] || 0) + 1;
	}

	// Count cards per weapon type
	const weaponCounts: Record<string, number> = {};
	for (const c of heroCards) {
		const wt = c.weapon_type || 'unknown';
		weaponCounts[wt] = (weaponCounts[wt] || 0) + 1;
	}

	// Count cards per parallel/insert type
	const parallelCounts: Record<string, number> = {};
	for (const c of heroCards) {
		const p = c.parallel || 'base';
		parallelCounts[p] = (parallelCounts[p] || 0) + 1;
	}

	// Track unique variations (hero + weapon + parallel = unique variation)
	const variationSet = new Set<string>();
	for (const c of heroCards) {
		const key = `${(c.hero_name || c.name || '').toLowerCase()}|${(c.weapon_type || '').toLowerCase()}|${(c.parallel || 'base').toLowerCase()}`;
		variationSet.add(key);
	}

	// ── Rule 1: Hero deck size ─────────────────────────────
	if (heroCards.length < format.heroDeckMin) {
		violations.push({
			rule: 'hero_deck_min',
			message: `Hero deck has ${heroCards.length} cards — minimum is ${format.heroDeckMin}`,
			severity: 'error'
		});
	}
	if (format.heroDeckMax && heroCards.length > format.heroDeckMax) {
		violations.push({
			rule: 'hero_deck_max',
			message: `Hero deck has ${heroCards.length} cards — maximum is ${format.heroDeckMax}`,
			severity: 'error'
		});
	}

	// ── Rule 2: SPEC power cap (individual card) ───────────
	if (format.specPowerCap !== null) {
		if (format.id === 'apex_madness') {
			// In Apex Madness, cards above the SPEC cap are only legal if they're unlocked Apex cards
			const coreDeckSize = format.heroDeckMin; // 60
			const coreCards = heroCards.slice(0, coreDeckSize);
			const apexCards = heroCards.slice(coreDeckSize);

			// Validate core deck: all must be at or below SPEC cap
			const coreOverSpec = coreCards.filter(c => (c.power || 0) > format.specPowerCap!);
			for (const card of coreOverSpec) {
				violations.push({
					rule: 'spec_power_cap',
					message: `Core Deck card "${card.hero_name || card.name}" has ${card.power} Power — exceeds ${format.specPowerCap} SPEC cap`,
					severity: 'error',
					cardIds: [card.id]
				});
			}

			// Validate apex cards: all must be at or above the apex minimum
			if (format.madnessApexMinPower) {
				for (const card of apexCards) {
					if ((card.power || 0) < format.madnessApexMinPower) {
						violations.push({
							rule: 'madness_apex_min',
							message: `Expanded Deck card "${card.hero_name || card.name}" has ${card.power} Power — Apex cards must be ${format.madnessApexMinPower}+`,
							severity: 'error',
							cardIds: [card.id]
						});
					}
				}
			}
		} else {
			// Non-Madness formats: simple SPEC cap on all cards
			const overSpecCards = heroCards.filter(c => (c.power || 0) > format.specPowerCap!);
			for (const card of overSpecCards) {
				violations.push({
					rule: 'spec_power_cap',
					message: `"${card.hero_name || card.name}" has ${card.power} Power — exceeds ${format.specPowerCap} SPEC cap`,
					severity: 'error',
					cardIds: [card.id]
				});
			}
		}
	}

	// ── Rule 3: Combined Power cap ─────────────────────────
	if (format.combinedPowerCap !== null && totalPower > format.combinedPowerCap) {
		violations.push({
			rule: 'combined_power_cap',
			message: `Total deck power is ${totalPower.toLocaleString()} — exceeds ${format.combinedPowerCap.toLocaleString()} Combined Power cap (over by ${(totalPower - format.combinedPowerCap).toLocaleString()})`,
			severity: 'error'
		});
	}

	// ── Rule 4: Max cards per power level ──────────────────
	for (const [level, count] of Object.entries(powerLevelCounts)) {
		if (count > format.maxPerPowerLevel) {
			const overCards = heroCards.filter(c => (c.power || 0) === Number(level));
			violations.push({
				rule: 'max_per_power_level',
				message: `${count} cards at Power ${level} — maximum ${format.maxPerPowerLevel} per power level`,
				severity: 'error',
				cardIds: overCards.map(c => c.id)
			});
		}
	}

	// ── Rule 5: Max 1 copy per unique variation ────────────
	const variationDupes = new Map<string, Card[]>();
	for (const c of heroCards) {
		const key = `${(c.hero_name || c.name || '').toLowerCase()}|${(c.weapon_type || '').toLowerCase()}|${(c.parallel || 'base').toLowerCase()}`;
		if (!variationDupes.has(key)) variationDupes.set(key, []);
		variationDupes.get(key)!.push(c);
	}
	for (const [, cards] of variationDupes) {
		if (cards.length > format.maxPerVariation) {
			violations.push({
				rule: 'max_per_variation',
				message: `${cards.length} copies of "${cards[0].hero_name || cards[0].name}" (${cards[0].weapon_type || 'unknown'} / ${cards[0].parallel || 'base'}) — max ${format.maxPerVariation} per variation`,
				severity: 'error',
				cardIds: cards.map(c => c.id)
			});
		}
	}

	// ── Rule 6: Allowed parallels (themed formats) ─────────
	if (format.allowedParallels) {
		for (const c of heroCards) {
			const cardParallel = (c.parallel || 'base').toLowerCase();
			if (!format.allowedParallels.includes(cardParallel) && cardParallel !== 'base') {
				violations.push({
					rule: 'allowed_parallels',
					message: `"${c.hero_name || c.name}" uses ${c.parallel} parallel — only ${format.allowedParallels.join(', ')} are allowed in ${format.name}`,
					severity: 'error',
					cardIds: [c.id]
				});
			}
		}
	}

	// ── Rule 7: Allowed weapons (themed formats) ───────────
	if (format.allowedWeapons) {
		for (const c of heroCards) {
			const wt = (c.weapon_type || '').toLowerCase();
			if (wt && !format.allowedWeapons.includes(wt)) {
				violations.push({
					rule: 'allowed_weapons',
					message: `"${c.hero_name || c.name}" uses ${c.weapon_type} weapon — only ${format.allowedWeapons.join(', ')} are allowed in ${format.name}`,
					severity: 'error',
					cardIds: [c.id]
				});
			}
		}
	}

	// ── Rule 8: Apex Madness insert unlock validation ──────
	let madnessUnlockedInserts: string[] = [];
	let madnessTotalApexAllowed = 0;

	if (format.id === 'apex_madness' && format.madnessInsertUnlockThreshold) {
		// Count inserts in the Core Deck (first 60 cards) that are at or below SPEC cap
		const coreDeck = heroCards.filter(c => (c.power || 0) <= (format.specPowerCap || 999));

		// Count each insert type (including wild Supers)
		const insertCounts = new Map<string, number>();
		let wildCount = 0;

		for (const c of coreDeck) {
			const parallel = c.parallel || 'base';
			const pt = getParallel(parallel);
			if (!pt?.isMadnessInsert) continue;

			if (pt.isWild) {
				wildCount++;
			} else {
				insertCounts.set(pt.key, (insertCounts.get(pt.key) || 0) + 1);
			}
		}

		// Determine which insert types hit the threshold (10+)
		// Wild cards fill the gap for the insert type closest to unlocking
		const unlocked: string[] = [];
		const nearMiss: Array<{ key: string; count: number; needed: number }> = [];

		for (const [key, count] of insertCounts) {
			if (count >= format.madnessInsertUnlockThreshold) {
				unlocked.push(key);
			} else {
				nearMiss.push({ key, count, needed: format.madnessInsertUnlockThreshold - count });
			}
		}

		// Apply wild cards to near-misses (sorted by closest to unlocking)
		nearMiss.sort((a, b) => a.needed - b.needed);
		let remainingWilds = wildCount;
		for (const nm of nearMiss) {
			if (remainingWilds >= nm.needed) {
				unlocked.push(nm.key);
				remainingWilds -= nm.needed;
			}
		}

		// Cap at max insert unlocks
		madnessUnlockedInserts = unlocked.slice(0, format.madnessMaxInsertUnlocks || 6);

		// Foil Hot Dog bonus
		const foilHotDogBonus = format.madnessFoilHotDogBonusCards || 0;

		madnessTotalApexAllowed = madnessUnlockedInserts.length + foilHotDogBonus;

		// Check if the deck has more Apex cards than allowed
		const apexCards = heroCards.filter(c => (c.power || 0) >= (format.madnessApexMinPower || 165));
		const coreApex = apexCards.filter(c => coreDeck.includes(c));
		const expandedApex = apexCards.length - coreApex.length;

		if (expandedApex > madnessTotalApexAllowed) {
			violations.push({
				rule: 'madness_apex_limit',
				message: `${expandedApex} Apex cards in Expanded Deck — only ${madnessTotalApexAllowed} allowed (${madnessUnlockedInserts.length} from inserts + ${foilHotDogBonus} from foil Hot Dogs)`,
				severity: 'error'
			});
		}

		// Report near-misses as warnings
		for (const nm of nearMiss) {
			if (!madnessUnlockedInserts.includes(nm.key)) {
				warnings.push(`${nm.key}: ${nm.count}/${format.madnessInsertUnlockThreshold} for Apex unlock (need ${nm.needed} more)`);
			}
		}
	}

	// ── Rule 9: Playbook DBS cap ───────────────────────────
	let dbsTotal: number | null = null;
	if (format.dbsCap && playCards.length > 0) {
		const playNumbers = playCards.map(c => c.card_number || '').filter(Boolean);
		const dbsResult = calculateTotalDbs(playNumbers);
		if (dbsResult) {
			dbsTotal = dbsResult.total;
			if (dbsResult.total > format.dbsCap) {
				violations.push({
					rule: 'dbs_cap',
					message: `Playbook DBS total is ${dbsResult.total} — exceeds ${format.dbsCap} cap (over by ${dbsResult.total - format.dbsCap})`,
					severity: 'error'
				});
			}
			if (dbsResult.missing.length > 0) {
				warnings.push(`DBS scores missing for ${dbsResult.missing.length} Play card(s): ${dbsResult.missing.join(', ')}`);
			}
		} else {
			warnings.push('DBS validation skipped — score data not yet available');
		}
	}

	// ── Build stats ────────────────────────────────────────
	const stats: DeckStats = {
		totalHeroes: heroCards.length,
		totalPower,
		averagePower: heroCards.length > 0 ? Math.round(totalPower / heroCards.length * 10) / 10 : 0,
		maxPower,
		minPower,
		uniqueVariations: variationSet.size,
		powerLevelCounts,
		weaponCounts,
		parallelCounts,
		madnessUnlockedInserts,
		madnessTotalApexAllowed,
		dbsTotal
	};

	return {
		isValid: violations.filter(v => v.severity === 'error').length === 0,
		formatId: format.id,
		formatName: format.name,
		violations,
		warnings,
		stats
	};
}

function emptyStats(): DeckStats {
	return {
		totalHeroes: 0, totalPower: 0, averagePower: 0, maxPower: 0, minPower: 0,
		uniqueVariations: 0, powerLevelCounts: {}, weaponCounts: {}, parallelCounts: {},
		madnessUnlockedInserts: [], madnessTotalApexAllowed: 0, dbsTotal: null
	};
}
