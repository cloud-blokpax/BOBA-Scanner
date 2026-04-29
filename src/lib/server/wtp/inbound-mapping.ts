/**
 * WTP listing.treatment → our cards.parallel name.
 *
 * Direction: INBOUND (matching scraped listings to our catalog).
 * Outbound (posting to WTP) is in services/wtp/parallel-mapping.ts.
 *
 * Returns null if WTP introduces a new treatment we don't recognize —
 * the scrape test surfaces unmapped values in the admin UI so we know
 * to add them.
 */

const WTP_TREATMENT_TO_PARALLEL: Record<string, string> = {
	Paper: 'Paper',
	'Classic Foil': 'Classic Foil',
	'Formless Foil': 'Formless Foil',
	OCM: 'Orbital Color Match',
	'Stone Foil': 'Stonefoil'
};

export function wtpTreatmentToParallel(treatment: string | null | undefined): string | null {
	if (!treatment) return null;
	return WTP_TREATMENT_TO_PARALLEL[treatment] ?? null;
}

/** Used by the scrape test to surface vocab drift. */
export function isKnownWtpTreatment(treatment: string): boolean {
	return treatment in WTP_TREATMENT_TO_PARALLEL;
}
