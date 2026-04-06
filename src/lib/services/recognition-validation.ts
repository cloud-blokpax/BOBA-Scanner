/**
 * Recognition Pipeline — Cross-Validation
 *
 * Validates AI-returned card data against the local card database.
 * Uses a cascading strategy: exact match → fuzzy match → trigram → hero name fallback.
 *
 * The card number is the primary key; the hero name is the verification check.
 * This module is pure logic — no side effects, no network calls, no state.
 */

import type { Card, ValidationMethod } from '$lib/types';
import { findCard, getAllCards } from './card-db';
import { findSimilarCardNumbers, searchCards } from './card-db-search';
import { trigramSimilarity, fuzzyNameMatch } from '$lib/utils/fuzzy-match';

// ── Types ───────────────────────────────────────────────────

export interface CrossValidationInput {
	cardNumber: string | null;
	heroName: string | null;
	power: number | null;
	confidence: number;
}

export interface CrossValidationResult {
	card: Card | null;
	confidence: number;
	validationMethod: ValidationMethod;
	warnings: string[];
}

// ── Main validation function ────────────────────────────────

/**
 * Cross-validate AI-returned card data against the local card database.
 *
 * Strategy (in order of confidence):
 *   1. Exact match on card_number → verify hero name matches
 *   2. Fuzzy match on card_number (Levenshtein distance ≤ 2) → verify hero name
 *   3. Trigram similarity on card_number → verify hero name
 *   4. Fallback: search by hero name + power to disambiguate
 *   5. No match found
 */
export function crossValidateCardResult(
	ai: CrossValidationInput,
	traceId: string
): CrossValidationResult {
	const warnings: string[] = [];
	const allCards = getAllCards();

	// ── Step 1: Exact match on card_number ──
	if (ai.cardNumber) {
		const exactMatch = findCard(ai.cardNumber);
		if (exactMatch) {
			// Verify hero name matches
			const nameScore = ai.heroName
				? fuzzyNameMatch(exactMatch.hero_name || exactMatch.name || '', ai.heroName)
				: 1; // No hero name from AI → skip verification

			if (nameScore > 0.7) {
				// Card number found and hero name agrees → HIGH CONFIDENCE
				return {
					card: exactMatch,
					confidence: ai.confidence,
					validationMethod: 'exact_match',
					warnings: []
				};
			}

			// Card number exists but hero name doesn't match → AI may have misread the number
			warnings.push(
				`Card number "${ai.cardNumber}" exists as "${exactMatch.hero_name || exactMatch.name}" ` +
				`but AI read hero as "${ai.heroName}". Possible card number misread.`
			);
			console.debug(
				`[scan:${traceId}:validate] Exact number match rejected: ` +
				`DB hero="${exactMatch.hero_name}" vs AI hero="${ai.heroName}" (score=${nameScore.toFixed(2)})`
			);
			// Fall through to fuzzy match — don't trust this card number
		}

		// ── Step 2: Fuzzy match on card_number ──
		const fuzzyResults = findSimilarCardNumbers(ai.cardNumber, 2);
		for (const match of fuzzyResults) {
			if (!ai.heroName) {
				// No hero name to verify — accept best fuzzy match with reduced confidence
				return {
					card: match.card,
					confidence: Math.min(ai.confidence, 0.65),
					validationMethod: 'fuzzy_match',
					warnings: [
						`Fuzzy matched card number: AI read "${ai.cardNumber}", ` +
						`matched to "${match.card.card_number}" (distance: ${match.distance})`
					]
				};
			}

			const nameScore = fuzzyNameMatch(
				match.card.hero_name || match.card.name || '',
				ai.heroName
			);

			if (nameScore > 0.7) {
				// Fuzzy number match + hero name agrees → MEDIUM CONFIDENCE
				return {
					card: match.card,
					confidence: Math.min(ai.confidence, 0.75),
					validationMethod: 'fuzzy_match',
					warnings: [
						`Fuzzy matched card number: AI read "${ai.cardNumber}", ` +
						`matched to "${match.card.card_number}" (distance: ${match.distance})`
					]
				};
			}
		}

		// ── Step 2b: Trigram similarity for card numbers with unusual prefixes ──
		if (fuzzyResults.length === 0) {
			let bestTrigram: { card: Card; similarity: number } | null = null;
			for (const card of allCards) {
				if (!card.card_number) continue;
				const sim = trigramSimilarity(card.card_number, ai.cardNumber);
				if (sim > 0.6 && (!bestTrigram || sim > bestTrigram.similarity)) {
					// Verify hero name before accepting
					if (ai.heroName) {
						const nameScore = fuzzyNameMatch(
							card.hero_name || card.name || '',
							ai.heroName
						);
						if (nameScore > 0.7) {
							bestTrigram = { card, similarity: sim };
						}
					} else {
						bestTrigram = { card, similarity: sim };
					}
				}
			}

			if (bestTrigram) {
				return {
					card: bestTrigram.card,
					confidence: Math.min(ai.confidence, 0.7),
					validationMethod: 'fuzzy_match',
					warnings: [
						`Trigram matched card number: AI read "${ai.cardNumber}", ` +
						`matched to "${bestTrigram.card.card_number}" (similarity: ${bestTrigram.similarity.toFixed(2)})`
					]
				};
			}
		}
	}

	// ── Step 3: Fallback — search by hero name (+ power to disambiguate) ──
	if (ai.heroName) {
		const heroSearchResults = searchCards(ai.heroName, 10);

		if (heroSearchResults.length > 0) {
			// If we have power info, use it to disambiguate among hero matches
			if (ai.power && heroSearchResults.length > 1) {
				const powerMatch = heroSearchResults.find(c => c.power === ai.power);
				if (powerMatch) {
					warnings.push(
						`Could not validate card number "${ai.cardNumber ?? '(null)'}". ` +
						`Matched by hero name "${ai.heroName}" + power=${ai.power} → "${powerMatch.card_number}".`
					);
					return {
						card: powerMatch,
						confidence: Math.min(ai.confidence, 0.6),
						validationMethod: 'name_only_fallback',
						warnings
					};
				}
			}

			// Take the first hero match (lowest confidence)
			const bestMatch = heroSearchResults[0];
			warnings.push(
				`Could not validate card number "${ai.cardNumber ?? '(null)'}". ` +
				`Matched by hero name "${ai.heroName}" → "${bestMatch.card_number}". ` +
				`Card number may be incorrect — please verify.`
			);

			if (heroSearchResults.length > 1) {
				warnings.push(
					`Multiple variants found for "${ai.heroName}". User should verify card number.`
				);
			}

			return {
				card: bestMatch,
				confidence: Math.min(ai.confidence, 0.5),
				validationMethod: 'name_only_fallback',
				warnings
			};
		}
	}

	// ── Step 4: No match at all ──
	return {
		card: null,
		confidence: 0,
		validationMethod: 'unvalidated',
		warnings: [
			`Card not found in database. Number: "${ai.cardNumber ?? '(null)'}", ` +
			`Name: "${ai.heroName ?? '(null)'}". May be a new/unreleased card or misread.`
		]
	};
}
