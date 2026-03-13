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
			const prefix = match[1]
				.replace(/0/g, 'O')
				.replace(/8/g, 'B')
				.replace(/5/g, 'S')
				.replace(/1/g, 'I')
				.replace(/2/g, 'Z')
				.replace(/6/g, 'G');
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
