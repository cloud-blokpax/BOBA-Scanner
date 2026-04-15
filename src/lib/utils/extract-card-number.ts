/**
 * Backward-compatible re-export.
 *
 * The canonical implementation now lives in the BoBA game module at
 * src/lib/games/boba/extract.ts. This file re-exports for existing
 * consumers (recognition-tiers.ts, tests) so no imports need to change.
 */
export { extractCardNumber, KNOWN_PREFIXES } from '$lib/games/boba/extract';
