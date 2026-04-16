/**
 * Phase 5A: passive persona tracking.
 *
 * Fire-and-forget helper that increments one of four persona dimensions
 * for the current user via the Supabase RPC `increment_persona`. The RPC
 * enforces auth internally and uses diminishing returns so dimensions
 * asymptote toward 1.0.
 *
 * Called from four natural action points:
 *   collector     → successful scan persisted
 *   seller        → eBay listing created
 *   deck_builder  → deck created
 *   tournament    → tournament deck submitted
 *
 * Rules:
 * - Never await in a user-facing code path. Persona is telemetry.
 * - Silently drop on any failure (no auth, missing user row, network).
 * - Accepts a SupabaseClient so both browser and server callers work.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type PersonaDimension = 'collector' | 'seller' | 'deck_builder' | 'tournament';

/**
 * Fire-and-forget: increment one persona weight for the current user.
 * Never throws. Never blocks. Safe to call without awaiting.
 */
export function incrementPersona(
	client: SupabaseClient | null | undefined,
	dimension: PersonaDimension
): void {
	if (!client) return;
	// Detach from the caller's control flow entirely — this must never
	// affect user-visible latency or error state.
	void (async () => {
		try {
			await client.rpc('increment_persona', { p_dimension: dimension });
		} catch {
			// Swallow. Persona tracking is best-effort telemetry.
		}
	})();
}
