/**
 * BoBA Deck Balancing Score (DBS) Lookup
 *
 * Every Play and Bonus Play card has a DBS point value.
 * The total DBS across all Plays must stay at or below 1,000 for sanctioned events.
 *
 * DBS ranges: Low (0-20), Medium (21-40), High (41-60), Very High (61+)
 *
 * TODO: Populate from the official deck builder at deck-builder.bobattlearena.com
 * For now, this file provides the structure and a few known values.
 * The validator will skip DBS checks when scores are not available.
 */

/** DBS score for a specific Play card, keyed by card_number */
const DBS_SCORES: Record<string, number> = {
	// Placeholder — populate from official source
	// Format: 'PL-1': 25, 'PL-2': 15, etc.
};

/** Get the DBS score for a Play card. Returns null if not in the lookup. */
export function getDbsScore(cardNumber: string): number | null {
	return DBS_SCORES[cardNumber.toUpperCase()] ?? null;
}

/** Check if DBS data is available (enough cards have scores to be useful) */
export function isDbsDataAvailable(): boolean {
	return Object.keys(DBS_SCORES).length >= 20;
}

/** Calculate total DBS for a set of Play card numbers. Returns null if data is insufficient. */
export function calculateTotalDbs(cardNumbers: string[]): { total: number; missing: string[] } | null {
	if (!isDbsDataAvailable()) return null;

	let total = 0;
	const missing: string[] = [];

	for (const num of cardNumbers) {
		const score = getDbsScore(num);
		if (score !== null) {
			total += score;
		} else {
			missing.push(num);
		}
	}

	// If more than 25% of cards are missing scores, the total is unreliable
	if (missing.length > cardNumbers.length * 0.25) return null;

	return { total, missing };
}

export const DBS_CAP = 1000;
