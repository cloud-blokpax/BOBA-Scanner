/**
 * BoBA card number extraction from OCR text.
 *
 * Handles common OCR confusables (0↔O, 1↔I, 8↔B, 5↔S, 2↔Z, 6↔G)
 * and validates prefixes against the known BoBA prefix set.
 *
 * Moved from src/lib/utils/extract-card-number.ts to the BoBA game module
 * as part of the multi-game GameConfig extraction.
 */

// Known BoBA card number prefixes (update as new sets release)
export const KNOWN_PREFIXES = new Set([
	'BF', 'BFA', 'BBFA', 'BBF', 'BLBF', 'ABF', 'CBF', 'GBF', 'OBF', 'PBF',
	'SBF', 'HBF', 'IBF', 'RBF', 'BGBF', 'RHBF', 'OHBF', 'MBFA', 'GLBF',
	'PL', 'BPL', 'HTD', 'RAD', 'MIX', 'MI', 'BL', 'GGL', 'LOGO', 'FT',
	'SF', 'SL', 'CHILL', 'ALT', 'CJ', 'PG', 'HD'
]);

/**
 * Extract card number from OCR text.
 * Handles common OCR confusables (0↔O, 1↔I, etc.)
 */
export function extractCardNumber(text: string): string | null {
	const upper = text
		.toUpperCase()
		.replace(/[|!¡]/g, 'I')
		.replace(/[\\/()\[\].,]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	const patterns: RegExp[] = [
		/\b([A-Z]{1,6})[-–—]\s*(\d{1,4})\b/,
		/\b([A-Z]{1,6})\s+(\d{2,4})\b/,
		/\b([A-Z]{1,6})(\d{2,4})\b/,
		/([A-Z]{2,})[\s\-–—]*(\d{2,})/
	];

	for (const pattern of patterns) {
		const match = upper.match(pattern);
		if (match) {
			// Fix common OCR confusables in letter prefix
			const rawPrefix = match[1];
			const correctedPrefix = rawPrefix
				.replace(/0/g, 'O')
				.replace(/8/g, 'B')
				.replace(/5/g, 'S')
				.replace(/1/g, 'I')
				.replace(/2/g, 'Z')
				.replace(/6/g, 'G');
			// Use corrected prefix only if it matches a known prefix; otherwise keep raw
			const prefix = KNOWN_PREFIXES.has(correctedPrefix) ? correctedPrefix : rawPrefix;
			// Fix common OCR confusables in numeric part
			const numPart = match[2]
				.replace(/O/g, '0')
				.replace(/I/g, '1')
				.replace(/B/g, '8')
				.replace(/S/g, '5')
				.replace(/Z/g, '2')
				.replace(/G/g, '6');
			return `${prefix}-${numPart}`;
		}
	}

	// Numeric-only fallback (Alpha Edition: "76", "115")
	const numOnly = upper.match(/\b(\d{2,4})\b/);
	if (numOnly) return numOnly[1];

	return null;
}
