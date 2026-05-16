/**
 * eBay Standard Envelope (eSE) label costs paid by the seller out of proceeds.
 * Source: https://www.ebay.com/help/selling/shipping-items/setting-shipping-options/ebay-standard-envelope
 * Verified rates as of July 13, 2025 (post-USPS rate change).
 *
 * Card Scanner only sells single sleeved cards, which are always under 1 oz.
 * If we ever support multi-card lots, expand this to weight-tiered costs.
 */
export const ESE_LABEL_COST_USD = 0.74;

/**
 * Maximum item price for eSE eligibility. eBay enforces strictly < $20.00.
 * Above this threshold, listings must use Ground Advantage instead.
 */
export const ESE_PRICE_CEILING_USD = 20.00;

/**
 * Suppress the bump nudge above this price — bumping to next .99 above $18.49
 * still keeps the listing under the $20 eSE ceiling. Above $18.49, the bump
 * would push out of eSE territory and the nudge becomes counterproductive.
 */
export const NUDGE_PRICE_CEILING_USD = 18.49;

/**
 * Calculate the suggested bumped price to cover the eSE label cost.
 * Snaps to the next .99 charm-priced rung for psychological consistency.
 *
 * Examples:
 *   $4.99 → $5.99  (covers $0.74 with $0.26 cushion)
 *   $9.99 → $10.99 (covers $0.74 with $0.26 cushion)
 *   $12.50 → $13.49 (covers $0.74 with $0.25 cushion)
 *   $17.99 → $18.99 (covers $0.74 with $0.26 cushion)
 *
 * Returns null if the price is outside the nudge range (≤ 0, > $18.49, or already ≥$20).
 */
export function suggestedBumpedPrice(currentPrice: number): number | null {
	if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
	if (currentPrice > NUDGE_PRICE_CEILING_USD) return null;

	// Add label cost, then snap up to the next .99 charm-priced rung.
	const withLabel = currentPrice + ESE_LABEL_COST_USD;
	const nextDollar = Math.floor(withLabel) + 1;
	const charmTarget = nextDollar - 0.01;

	// Hard ceiling at $18.99 to preserve eSE eligibility.
	if (charmTarget >= ESE_PRICE_CEILING_USD) return null;

	// Only suggest if the bump is meaningfully more than the current price.
	// E.g., $11.99 already covers the $0.74 label; no need to nudge to $12.99.
	if (charmTarget - currentPrice < ESE_LABEL_COST_USD * 0.5) return null;

	return charmTarget;
}
