/**
 * BoBA Deck Balancing Score (DBS) Lookup
 *
 * Every Play and Bonus Play card has a DBS point value. The total DBS across
 * all Plays must stay at or below 1,000 for sanctioned events.
 *
 * Architecture:
 *   - Source of truth is public.play_cards (Supabase).
 *   - DBS_SCORES is auto-generated from the DB by scripts/generate-play-card-bundle.ts.
 *   - This file only contains lookup helpers; the data lives in
 *     boba-dbs-scores.generated.ts.
 *
 * To update DBS values:
 *   1. Apply a migration to public.play_cards (use scripts/generate-dbs-sync-migration.ts
 *      to scaffold one from the deck builder cards.json).
 *   2. Run `npm run generate-play-bundle` to refresh the generated file.
 *   3. Commit the migration + generated file together.
 *
 * Keyed by composite "set_code:card_number" since the same card number exists
 * across releases with different DBS values. HTD and LA cards use bare keys
 * (their card numbers are globally unique).
 *
 * DBS ranges (for UI grouping): Low (0-20), Medium (21-40), High (41-60), Very High (61+)
 */

import { DBS_SCORES } from './boba-dbs-scores.generated';

export interface PlayCardData {
	id: string;
	card_number: string;
	name: string;
	release: string;
	type: string;
	number: number;
	hot_dog_cost: number | null;
	dbs: number;
}

// ── Lookup helpers ────────────────────────────────────────────────────

/**
 * Optional Supabase-driven overlay for hot-fixing DBS values without a deploy.
 * loadDynamicDbs() can be wired up at runtime to populate this map; getDbs()
 * checks the overlay first, then falls back to the generated DBS_SCORES.
 */
let _dynamicDbs: Record<string, number> | null = null;

/** Build a composite key from set_code and card_number. */
function buildKey(cardNumber: string, setCode?: string): string {
	const num = cardNumber.trim().toUpperCase();
	if (setCode) {
		return setCode + ':' + num;
	}
	// HTD cards have unique numbers across releases — no set prefix needed.
	// (Older code path kept for backward compat; the generated map also writes
	// 'HTD-N' as bare keys, so either lookup works.)
	if (num.startsWith('HTD-')) {
		return 'Alpha Blast:' + num;
	}
	return num;
}

/**
 * Look up the DBS score for a Play card.
 *
 * @param cardNumber - e.g. "PL-1", "BPL-6", "HTD-12", "LA-20"
 * @param setCode - e.g. "Alpha Edition", "Griffey Edition" (required for PL/BPL).
 *                   Omit for HTD/LA cards.
 * Returns null if the card is not in the lookup.
 */
export function getDbsScore(cardNumber: string, setCode?: string): number | null {
	const key = buildKey(cardNumber, setCode);
	return _dynamicDbs?.[key] ?? DBS_SCORES[key] ?? null;
}

/** Alias for getDbsScore. Existing call sites use this name. */
export function getDbs(cardNumber: string, setCode?: string): number | null {
	return getDbsScore(cardNumber, setCode);
}

/** Sanity check the lookup is populated (catches build/import regressions). */
function isDbsDataAvailable(): boolean {
	return Object.keys(DBS_SCORES).length >= 20;
}

/**
 * Calculate total DBS for a set of Play cards.
 * Each entry is { cardNumber, setCode } to uniquely identify the play.
 * Returns null if too many cards are missing scores (unreliable total).
 */
export function calculateTotalDbs(
	cards: Array<{ cardNumber: string; setCode?: string }>
): { total: number; missing: string[] } | null {
	if (!isDbsDataAvailable()) return null;

	let total = 0;
	const missing: string[] = [];

	for (const { cardNumber, setCode } of cards) {
		const score = getDbsScore(cardNumber, setCode);
		if (score !== null) {
			total += score;
		} else {
			missing.push(setCode ? setCode + ':' + cardNumber : cardNumber);
		}
	}

	// If more than 25% of cards are missing scores, the total is unreliable.
	if (missing.length > cards.length * 0.25) return null;

	return { total, missing };
}

/** DBS budget cap for sanctioned events (e.g. AlphaTrilogy, APEX 1,000-DBS limit). */
export const DBS_CAP = 1000;

/**
 * Return a copy of the merged DBS scores map (generated + overlay).
 * Used by server endpoints that need to ship the full map to a Svelte page.
 */
export function getDbsScoresMap(): Record<string, number> {
	return { ...DBS_SCORES, ...(_dynamicDbs ?? {}) };
}

// ── Optional runtime overlay (Supabase-driven hot fixes) ─────────────
// Not wired up by default. To enable: import { setDynamicDbs } and call it
// from a server hook or admin action with values from a future
// `dbs_overlay` table. Until then, the only path to update DBS values is
// the migration → generator → deploy workflow.

export function setDynamicDbs(map: Record<string, number> | null): void {
	_dynamicDbs = map;
}
