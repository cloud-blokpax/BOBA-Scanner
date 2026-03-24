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

	// ── Rule: Hot Dog deck size ──────────────────────────────
	if (!format.heroOnlyGameplay && format.hotDogDeckSize > 0) {
		if (hotDogCards.length !== format.hotDogDeckSize) {
			violations.push({
				rule: 'hot_dog_deck_size',
				message: `Hot Dog deck has ${hotDogCards.length} cards — requires exactly ${format.hotDogDeckSize}`,
				severity: 'error'
			});
		}
	}

	// ── Rule: Foil Hot Dog requirement (Madness) ────────────
	if (format.requiresFoilHotDogs && format.requiredFoilHotDogCount > 0) {
		const foilHotDogs = hotDogCards.filter(c => {
			const p = (c.parallel || '').toLowerCase();
			return p.includes('foil') || p.includes('battlefoil');
		});
		if (foilHotDogs.length < format.requiredFoilHotDogCount) {
			violations.push({
				rule: 'foil_hot_dog_requirement',
				message: `${foilHotDogs.length} foil Hot Dogs — ${format.name} requires ${format.requiredFoilHotDogCount} foil Hot Dogs`,
				severity: 'error'
			});
		}
	}

	// ── Rule 2: SPEC power cap (individual card) ───────────
	if (format.specPowerCap !== null) {
		if (format.id === 'apex_madness') {
			// In Apex Madness, split by power level (not array position).
			// Core Deck = cards at or below SPEC cap, Expanded = cards above.
			const coreCards = heroCards.filter(c => (c.power || 0) <= format.specPowerCap!);
			const apexCards = heroCards.filter(c => (c.power || 0) > format.specPowerCap!);

			// Validate core deck has enough cards
			if (coreCards.length < format.heroDeckMin) {
				violations.push({
					rule: 'core_deck_min',
					message: `Core Deck has ${coreCards.length} cards at ≤${format.specPowerCap} Power — need ${format.heroDeckMin}`,
					severity: 'error'
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

	// ── Rule 2b: Graduated power slot limits (SPEC+) ─────────
	if (format.powerSlotLimits) {
		for (const [powerStr, maxAllowed] of Object.entries(format.powerSlotLimits)) {
			const power = Number(powerStr);
			const count = heroCards.filter(c => (c.power || 0) === power).length;
			if (count > maxAllowed) {
				violations.push({
					rule: 'power_slot_limit',
					message: `${count} Heroes at Power ${power} — maximum ${maxAllowed} allowed in ${format.name}`,
					severity: 'error',
					cardIds: heroCards.filter(c => (c.power || 0) === power).map(c => c.id)
				});
			}
		}
	}

	// ── Rule 2c: Absolute max power ───────────────────────────
	if (format.absoluteMaxPower !== null) {
		const overMax = heroCards.filter(c => (c.power || 0) > format.absoluteMaxPower!);
		for (const card of overMax) {
			violations.push({
				rule: 'absolute_max_power',
				message: `"${card.hero_name || card.name}" has ${card.power} Power — exceeds ${format.absoluteMaxPower} absolute maximum in ${format.name}`,
				severity: 'error',
				cardIds: [card.id]
			});
		}
	}

	// ── Rule 2d: SPEC+ core deck requirement (need 60 cards at ≤160) ─
	if (format.id === 'spec_plus' && heroCards.length >= 60) {
		const specCoreCards = heroCards.filter(c => (c.power || 0) <= 160);
		if (specCoreCards.length < 60) {
			violations.push({
				rule: 'spec_plus_core',
				message: `Only ${specCoreCards.length} cards at ≤160 Power — SPEC+ requires at least 60 Core Deck cards at ≤160`,
				severity: 'error'
			});
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

	// ── Rule 6b: Silver Headlines minimum per parallel ──────
	if (format.id === 'silver_headlines') {
		const silverCount = heroCards.filter(c =>
			(c.parallel || '').toLowerCase() === 'silver'
		).length;
		const headlineCount = heroCards.filter(c =>
			['headline', 'headlines'].includes((c.parallel || '').toLowerCase())
		).length;
		if (silverCount < 20) {
			violations.push({
				rule: 'silver_headlines_min_silver',
				message: `Only ${silverCount} Silver cards — minimum 20 required in Silver Headlines`,
				severity: 'error'
			});
		}
		if (headlineCount < 20) {
			violations.push({
				rule: 'silver_headlines_min_headline',
				message: `Only ${headlineCount} Headline cards — minimum 20 required in Silver Headlines`,
				severity: 'error'
			});
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
		// Core Deck = cards at or below SPEC cap (by power level, not array position)
		const coreDeck = heroCards.filter(c => (c.power || 0) <= (format.specPowerCap || 160));

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
		// Expanded deck = cards above the SPEC cap
		const expandedDeck = heroCards.filter(c => (c.power || 0) > (format.specPowerCap || 160));
		const expandedApex = expandedDeck.filter(c => (c.power || 0) >= (format.madnessApexMinPower || 165)).length;

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
		const playEntries = playCards
			.filter(c => c.card_number)
			.map(c => ({ cardNumber: c.card_number!, setCode: c.set_code || undefined }));
		const dbsResult = calculateTotalDbs(playEntries);
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
