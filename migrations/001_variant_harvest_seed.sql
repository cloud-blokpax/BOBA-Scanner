-- Migration 1 — Seed table + structural population
--
-- Wonders variant harvest seed: a source-of-truth for which (card_id, variant)
-- pairs to schedule for price harvesting, independent of user collection state.
--
-- Design principle: if a card's physical variant is knowable from its collector
-- number pattern, pre-seed it here so the harvester doesn't wait for a user
-- to scan one. SF (1/1s) are NOT seeded — they're card-specific, not pattern-
-- specific, and can be added by admin follow-up.
--
-- Safe to re-run. UNION CTEs are conflict-skipped on (card_id, variant) PK.

CREATE TABLE IF NOT EXISTS public.variant_harvest_seed (
  card_id    uuid        NOT NULL,
  variant    text        NOT NULL,
  reason     text        NOT NULL,  -- 'structural:ocm', 'structural:ff', 'structural:cf', 'admin'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, variant),
  CONSTRAINT variant_harvest_seed_variant_chk
    CHECK (variant IN ('paper','cf','ff','ocm','sf'))
);

COMMENT ON TABLE public.variant_harvest_seed IS
  'Structural seed of (card_id, variant) pairs to harvest prices for, beyond '
  'what user collections reveal. Read by get_harvest_candidates RPC. Wonders-only '
  'today; BoBA encodes variants in card_number so this table is empty for BoBA.';

-- Grant read to authenticated (admin UI can show seed state to you)
GRANT SELECT ON public.variant_harvest_seed TO authenticated;
-- Admin writes happen via service role; no RLS needed for a catalog table
ALTER TABLE public.variant_harvest_seed ENABLE ROW LEVEL SECURITY;
CREATE POLICY variant_harvest_seed_read_all ON public.variant_harvest_seed
  FOR SELECT TO authenticated USING (true);

-- ── Structural seed: OCM (Orbital Color Match) variants ────────
-- Every card with collector_number matching A1-### is physically an OCM printing.
-- The card row IS the OCM variant — its paper printing lives at a different
-- collector number. Harvesting paper for these IDs returns polluted data; see Migration 3.
INSERT INTO public.variant_harvest_seed (card_id, variant, reason)
SELECT c.id, 'ocm', 'structural:ocm'
FROM public.cards c
WHERE c.game_id = 'wonders'
  AND c.card_number ~ '^A1-'
ON CONFLICT (card_id, variant) DO NOTHING;

-- ── Structural seed: FF (Formless Foil) promos ─────────────────
-- P-### cards are always Formless Foil per the game's printing conventions
-- (no paper version exists for these collector numbers).
INSERT INTO public.variant_harvest_seed (card_id, variant, reason)
SELECT c.id, 'ff', 'structural:ff'
FROM public.cards c
WHERE c.game_id = 'wonders'
  AND c.card_number ~ '^P-'
ON CONFLICT (card_id, variant) DO NOTHING;

-- ── Structural seed: CF (Classic Foil) for base cards ──────────
-- Base cards (plain numeric or N/NNN collector numbers) have a first-edition
-- Classic Foil printing in addition to paper. Both variants are worth harvesting.
-- Tokens, story tokens, and set artifacts are excluded — those are paper-only.
INSERT INTO public.variant_harvest_seed (card_id, variant, reason)
SELECT c.id, 'cf', 'structural:cf'
FROM public.cards c
WHERE c.game_id = 'wonders'
  AND c.card_number ~ '^[0-9]+(/[0-9]+)?$'
ON CONFLICT (card_id, variant) DO NOTHING;

-- Verification snapshot — should show 892 total rows (30 ocm + 53 ff + 809 cf)
SELECT reason, count(*) FROM public.variant_harvest_seed GROUP BY reason ORDER BY reason;
