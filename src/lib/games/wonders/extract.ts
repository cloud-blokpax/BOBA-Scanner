/**
 * Wonders of The First — card number extraction from OCR text.
 *
 * Returns the collector_number as stored in the Supabase `cards` table's
 * `card_number` column so lookups succeed via the card-db index.
 *
 * Known collector number formats in the DB:
 *   - "78/402"       NUM/TOTAL (Call of the Stones)
 *   - "115"          plain numeric (Existence set) — intentionally NOT matched here
 *                    in auto-detect mode because it collides with BoBA numbering.
 *   - "P-001"        Promos
 *   - "AVA-T1"       Story tokens with set prefix
 *   - "A1-028/401"   OCM (Orbital Color Match) variant
 *   - "T-016"        Generated tokens
 *   - "CLA-1"        Set artifact cards
 */

// All known Wonders set/prefix codes (from the production database).
export const WONDERS_PREFIXES = new Set([
	'A1', 'AVA', 'BAA', 'CLA', 'EEA', 'KSA', 'P', 'T', 'TFA', 'XCA'
]);

/**
 * Extract a Wonders collector number from raw OCR text.
 *
 * IMPORTANT: The plain-numeric pattern (e.g., "115" for Existence) is
 * intentionally omitted — it would false-match BoBA card numbers during
 * auto-detect. Existence cards without a visible set indicator fall through
 * to Tier 3 (Claude AI) in auto-detect mode. When the user has explicitly
 * selected Wonders as the game, Tier 2 may be extended upstream to try the
 * plain-numeric pattern, but that's the caller's responsibility.
 */
export function extractWondersCardNumber(text: string): string | null {
	// Normalize common OCR confusables and whitespace
	const cleaned = text
		.toUpperCase()
		.replace(/[|!¡]/g, 'I')
		.replace(/[{}[\]]/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	// Pattern 1: OCM variant — "A1-028/401"
	// Must check BEFORE the generic set-prefix pattern to avoid partial match.
	const ocmMatch = cleaned.match(/\bA1-(\d{1,3})\/(\d{3,4})\b/);
	if (ocmMatch) return `A1-${ocmMatch[1].padStart(3, '0')}/${ocmMatch[2]}`;

	// Pattern 2: Story tokens with set prefix — "AVA-T1", "XCA-T6", "CLA-T1"
	const storyTokenMatch = cleaned.match(/\b([A-Z]{2,3})-T(\d{1,2})\b/);
	if (storyTokenMatch && WONDERS_PREFIXES.has(storyTokenMatch[1])) {
		return `${storyTokenMatch[1]}-T${storyTokenMatch[2]}`;
	}

	// Pattern 3: Promos — "P-001" to "P-053" (before set-artifact to avoid P prefix collision)
	const promoMatch = cleaned.match(/\bP-(\d{1,3})\b/);
	if (promoMatch) return `P-${promoMatch[1].padStart(3, '0')}`;

	// Pattern 4: Generated tokens — "T-001" to "T-036"
	const tokenMatch = cleaned.match(/\bT-(\d{1,3})\b/);
	if (tokenMatch) return `T-${tokenMatch[1].padStart(3, '0')}`;

	// Pattern 5: Set artifact cards — "AVA-1", "CLA-1", "XCA-1"
	const setArtifactMatch = cleaned.match(/\b([A-Z]{2,3})-(\d{1,2})\b/);
	if (
		setArtifactMatch &&
		WONDERS_PREFIXES.has(setArtifactMatch[1]) &&
		setArtifactMatch[1] !== 'A1' && // A1 is OCM (already handled)
		setArtifactMatch[1] !== 'P' &&  // P is promo (already handled)
		setArtifactMatch[1] !== 'T'     // T is token (already handled)
	) {
		return `${setArtifactMatch[1]}-${setArtifactMatch[2]}`;
	}

	// Pattern 6: Standard card with total — "78/402", "205/402"
	// The /TOTAL suffix confirms Wonders (BoBA never uses this format).
	const numTotalMatch = cleaned.match(/\b(\d{1,3})\/(\d{3,4})\b/);
	if (numTotalMatch) return `${numTotalMatch[1]}/${numTotalMatch[2]}`;

	// Pattern 7 (plain numeric): intentionally omitted — collides with BoBA.

	// Fallback: stamp-robust prefix search. OCR may have captured the 1st
	// edition stamp as leading characters that don't match any known prefix
	// pattern (common Tesseract misreads: "I", "1", "(1)", "O"). Scan the
	// cleaned text for a known prefix anchor and re-extract from there.
	for (const prefix of WONDERS_PREFIXES) {
		// Try the prefix-with-total pattern first (OCM format)
		const prefixRegex = new RegExp(`\\b${prefix}-(\\d{1,3})(?:/(\\d{3,4}))?\\b`);
		const match = cleaned.match(prefixRegex);
		if (match) {
			if (prefix === 'P' || prefix === 'T') {
				// Promos/tokens always pad to 3 digits, no /TOTAL suffix
				return `${prefix}-${match[1].padStart(3, '0')}`;
			}
			if (prefix === 'A1' && match[2]) {
				return `A1-${match[1].padStart(3, '0')}/${match[2]}`;
			}
			if (match[2]) {
				return `${prefix}-${match[1]}/${match[2]}`;
			}
			return `${prefix}-${match[1]}`;
		}

		// Also try story token pattern: SET-T<number>
		if (prefix !== 'P' && prefix !== 'T' && prefix !== 'A1') {
			const tokenRegex = new RegExp(`\\b${prefix}-T(\\d{1,2})\\b`);
			const tokenMatch = cleaned.match(tokenRegex);
			if (tokenMatch) return `${prefix}-T${tokenMatch[1]}`;
		}
	}

	return null;
}
