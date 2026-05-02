/**
 * Phase 1 Doc 1.0 — Catalog cross-validation gate.
 *
 * Given the OCR'd (card_number, name, parallel) tuple AND the cards row
 * returned by lookupCard/fuzzy, decide whether the lookup is trustworthy.
 * The gate is conservative on purpose: when confidence is low or signals
 * disagree, we'd rather force a Haiku fallback than ship a wrong answer.
 *
 * This is a pure function of OCR outputs + a candidate cards row; it does
 * no I/O. Called from recognition-tiers.ts after runCanonicalTier1 resolves.
 */

import { levenshtein, normalizeOcrName } from '$lib/utils/normalize-ocr-name';
import type { MirrorCard } from './catalog-mirror';

export type ValidationResult =
	| { passed: true }
	| {
			passed: false;
			reason:
				| 'no_catalog_match'
				| 'card_number_name_mismatch'
				| 'parallel_mismatch'
				| 'multiple_match_ambiguous'
				| 'name_only_no_card_number'
				| 'card_number_only_no_name';
	  };

export interface ValidationInput {
	game: 'boba' | 'wonders';
	ocrCardNumber: string | null;
	ocrName: string | null;
	ocrParallel: string | null;
	candidateCard: MirrorCard | null;
}

const NAME_DIST_TOLERANCE_FN = (catalogName: string): number => {
	if (catalogName.length <= 6) return 1;
	return Math.max(2, Math.floor(catalogName.length * 0.15));
};

export function validateCatalogTriangulation(
	input: ValidationInput
): ValidationResult {
	const { game, ocrCardNumber, ocrName, ocrParallel, candidateCard } = input;

	if (!candidateCard) return { passed: false, reason: 'no_catalog_match' };

	if (!ocrCardNumber && !ocrName) return { passed: false, reason: 'no_catalog_match' };

	if (!ocrCardNumber) {
		return { passed: false, reason: 'name_only_no_card_number' };
	}
	if (!ocrName) {
		return { passed: false, reason: 'card_number_only_no_name' };
	}

	// Card number must match exactly (modulo fractional → integer fallback
	// already handled by lookupCard before we got here).
	const cardNumMatches =
		candidateCard.card_number === ocrCardNumber ||
		(ocrCardNumber.includes('/') && candidateCard.card_number === ocrCardNumber.split('/')[0]);

	const catalogName = (game === 'boba' ? candidateCard.hero_name : candidateCard.name) ?? '';
	const nameDist = levenshtein(normalizeOcrName(ocrName), normalizeOcrName(catalogName));
	const nameOk = nameDist <= NAME_DIST_TOLERANCE_FN(catalogName);

	if (!cardNumMatches || !nameOk) {
		return { passed: false, reason: 'card_number_name_mismatch' };
	}

	// Wonders parallel disambiguation — when an OCR'd parallel is present
	// it must match the candidate row's parallel. BoBA parallel is derived
	// from the card_number prefix and is already part of the lookup key.
	if (game === 'wonders' && ocrParallel && candidateCard.parallel) {
		if (ocrParallel !== candidateCard.parallel) {
			return { passed: false, reason: 'parallel_mismatch' };
		}
	}

	return { passed: true };
}
