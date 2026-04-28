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
import { findCard, getAllCards, wondersCardNumberAlternates } from './card-db';
import { findSimilarCardNumbers, searchCards } from './card-db-search';
import { trigramSimilarity, fuzzyNameMatch } from '$lib/utils/fuzzy-match';

// ── Digit-substitution candidate generation ─────────────────
// Font-based digit confusions observed in production scans. Groups are
// mutually-confusable sets, not asymmetric pairs — a read `8` could be
// a real `6` or `0`, not just `3` or `5`. Add to these groups only when
// you see a misread in prod, not speculatively.
const AMBIGUOUS_DIGIT_GROUPS: readonly string[][] = [
	['3', '5', '8'],      // Existence serif 3↔5 (confirmed: clock, token)
	['0', '6', '8', '9'], // rounded-digit confusions at low resolution
];

/**
 * Generate card-number candidates by single-digit substitution on visually
 * ambiguous digits. Returns a Set (deduped) excluding the original input.
 *
 * Example: "T-050" → Set { "T-030", "T-080", "T-058", "T-056", "T-059", "T-853", ... }
 *
 * Only ONE digit is swapped per candidate. Multi-digit errors are the job
 * of the Levenshtein-2 fuzzy fallback — don't duplicate that work here.
 *
 * Non-digit characters (letters, dashes, slashes) pass through unchanged.
 */
function generateDigitSubstitutionCandidates(cardNumber: string): Set<string> {
	const out = new Set<string>();
	for (let i = 0; i < cardNumber.length; i++) {
		const ch = cardNumber[i];
		for (const group of AMBIGUOUS_DIGIT_GROUPS) {
			if (!group.includes(ch)) continue;
			for (const alt of group) {
				if (alt === ch) continue;
				out.add(cardNumber.slice(0, i) + alt + cardNumber.slice(i + 1));
			}
		}
	}
	return out;
}

// ── Types ───────────────────────────────────────────────────

export interface CrossValidationInput {
	cardNumber: string | null;
	heroName: string | null;
	power: number | null;
	confidence: number;
	/** Wonders only — parallel name as returned by Tier 3 / canonical classifier
	 *  (e.g. "Formless Foil"). Used to disambiguate among same-(card_number,
	 *  name) rows post-parallel-expansion. BoBA callers omit. */
	parallel?: string | null;
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
	traceId: string,
	gameId: string = 'boba'
): CrossValidationResult {
	const warnings: string[] = [];
	// Scope candidate pool to the target game when the in-memory index
	// holds multiple games. When only one game is loaded, filtering is a no-op.
	const allCards = getAllCards().filter(
		(c) => (c.game_id || 'boba') === gameId
	);

	// ── Step 1: Exact match on card_number ──
	// Wonders: try the input as-is first, then format alternates ("130/401"
	// → ["130/401", "130"]) to bridge the Existence-set format mismatch
	// (physical cards print N/401, DB stores plain N for ~99% of Existence).
	// BoBA: single-candidate pass — no alternates apply.
	if (ai.cardNumber) {
		const numberCandidates = gameId === 'wonders'
			? wondersCardNumberAlternates(ai.cardNumber)
			: [ai.cardNumber];

		for (const candidate of numberCandidates) {
			const exactMatch = findCard(candidate, null, gameId, ai.parallel ?? null);
			if (!exactMatch) continue;

			// Verify hero name matches
			const nameScore = ai.heroName
				? fuzzyNameMatch(exactMatch.hero_name || exactMatch.name || '', ai.heroName)
				: 1; // No hero name from AI → skip verification

			if (nameScore > 0.7) {
				// Card number found and hero name agrees → HIGH CONFIDENCE
				const usedAlternate = candidate !== ai.cardNumber;
				return {
					card: exactMatch,
					confidence: ai.confidence,
					validationMethod: 'exact_match',
					warnings: usedAlternate
						? [`Card number "${ai.cardNumber}" matched DB via format alternate "${candidate}".`]
						: []
				};
			}

			// Candidate exists but hero name doesn't match → AI may have misread
			warnings.push(
				`Card number "${candidate}" exists as "${exactMatch.hero_name || exactMatch.name}" ` +
				`but AI read hero as "${ai.heroName}". Possible card number misread.`
			);
			console.debug(
				`[scan:${traceId}:validate] Exact number match rejected: ` +
				`candidate="${candidate}" DB hero="${exactMatch.hero_name}" ` +
				`vs AI hero="${ai.heroName}" (score=${nameScore.toFixed(2)})`
			);
			// Continue to next candidate; if all exhausted, fall through to fuzzy
		}

		// ── Step 2: Fuzzy match on card_number ──
		// Wonders: run fuzzy against both the input and its format alternates so
		// a misread like "150/401" can find "130" (stored plain) at Levenshtein 1
		// via the "150" alternate, instead of the Levenshtein 4+ that
		// "150/401" ↔ "130" would produce directly.
		const fuzzyInputs = gameId === 'wonders'
			? wondersCardNumberAlternates(ai.cardNumber)
			: [ai.cardNumber];
		const fuzzyResultsByCardId = new Map<
			string,
			{ card: Card; cardNumber: string; distance: number; score: number }
		>();
		for (const input of fuzzyInputs) {
			for (const r of findSimilarCardNumbers(input, 2, gameId)) {
				const prev = fuzzyResultsByCardId.get(r.card.id);
				// Keep min-distance result when the same card is found through
				// multiple alternate inputs.
				if (!prev || r.distance < prev.distance) {
					fuzzyResultsByCardId.set(r.card.id, r);
				}
			}
		}
		const refLen = ai.cardNumber.length;
		const fuzzyResults = Array.from(fuzzyResultsByCardId.values())
			.sort((a, b) => {
				// Primary: lower distance wins (preserves original behavior)
				if (a.distance !== b.distance) return a.distance - b.distance;
				// Secondary: prefer cardNumber lengths close to original input
				const aLenDiff = Math.abs(a.cardNumber.length - refLen);
				const bLenDiff = Math.abs(b.cardNumber.length - refLen);
				return aLenDiff - bLenDiff;
			});

		// If we have multiple hero-name-verified matches at the same distance,
		// use power to disambiguate
		const verifiedMatches: typeof fuzzyResults = [];
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
				verifiedMatches.push(match);
			}
		}

		if (verifiedMatches.length > 0) {
			// If we have power info and multiple candidates, prefer power match
			let bestMatch = verifiedMatches[0];
			if (ai.power && verifiedMatches.length > 1) {
				const powerMatch = verifiedMatches.find(m => m.card.power === ai.power);
				if (powerMatch) {
					bestMatch = powerMatch;
				}
			}

			return {
				card: bestMatch.card,
				confidence: Math.min(ai.confidence, 0.75),
				validationMethod: 'fuzzy_match',
				warnings: [
					`Fuzzy matched card number: AI read "${ai.cardNumber}", ` +
					`matched to "${bestMatch.card.card_number}" (distance: ${bestMatch.distance})`
				]
			};
		}

		// ── Step 2b: Digit-substitution candidates ──
		// Targeted single-digit swap on visually ambiguous pairs (3↔5, 6↔8, etc).
		// Runs only when Levenshtein-2 fuzzy returned nothing — catches cases where
		// the misread changed the leading characters enough that the prefix index
		// in findSimilarCardNumbers excluded the real card. Hero-name verification
		// is REQUIRED — at prod scale there are 12K+ single-digit-adjacent card
		// pairs in BoBA alone, so name match is the only safe disambiguator.
		if (fuzzyResults.length === 0 && ai.heroName) {
			const subCandidates = generateDigitSubstitutionCandidates(ai.cardNumber);
			let bestSubMatch: Card | null = null;
			let bestCandidateUsed = '';

			for (const candidate of subCandidates) {
				// Thread Wonders format alternates so "130" substitution can find
				// Existence's stored-plain "130" AND any future-stored "130/401".
				const lookupForms = gameId === 'wonders'
					? wondersCardNumberAlternates(candidate)
					: [candidate];

				for (const form of lookupForms) {
					const match = findCard(form, null, gameId, ai.parallel ?? null);
					if (!match) continue;

					const nameScore = fuzzyNameMatch(
						match.hero_name || match.name || '',
						ai.heroName
					);
					if (nameScore <= 0.7) continue; // name mismatch — keep looking

					// Found a name-verified substitution. Prefer the first one found
					// (ordering of AMBIGUOUS_DIGIT_GROUPS is by observed frequency).
					bestSubMatch = match;
					bestCandidateUsed = candidate;
					break;
				}
				if (bestSubMatch) break;
			}

			if (bestSubMatch) {
				return {
					card: bestSubMatch,
					confidence: Math.min(ai.confidence, 0.75),
					validationMethod: 'fuzzy_match',
					warnings: [
						`Digit-substitution matched: AI read "${ai.cardNumber}", ` +
						`corrected to "${bestSubMatch.card_number}" via ambiguous-digit ` +
						`swap (candidate "${bestCandidateUsed}", name verified: "${ai.heroName}").`
					]
				};
			}
		}

		// ── Step 2c: Trigram similarity for card numbers with unusual prefixes ──
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

	// ── Step 3: Fallback — search by hero name (+ power / parallel to disambiguate) ──
	if (ai.heroName) {
		const rawHeroResults = searchCards(ai.heroName, 10, gameId);

		// Wonders parallel filter — restrict to the requested parallel before
		// power/first-match disambiguation, so we don't pick a random parallel
		// row when card_number couldn't be resolved.
		const heroSearchResults =
			gameId === 'wonders' && ai.parallel && rawHeroResults.length > 1
				? (() => {
						const filtered = rawHeroResults.filter((c) => c.parallel === ai.parallel);
						return filtered.length > 0 ? filtered : rawHeroResults;
					})()
				: rawHeroResults;

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
					`Multiple parallels found for "${ai.heroName}". User should verify card number.`
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
