-- Migration 30 — Wonders parallel 5x expansion (pre-launch)
--
-- Replaces migration 001's structural seed. The previous model assumed
-- card_number prefixes encoded parallel: A1- = OCM, P- = FF, plain
-- numeric = Paper+CF. They don't. A1- indicates "alternate art" series,
-- P- indicates "promo" series — both ORTHOGONAL to the parallel
-- treatment of the physical card. Holding cards confirmed the actual
-- model: a single Wonders card (e.g. Cast Out 316/401, Existence) exists
-- in five physically distinct printings sharing the same collector
-- number — Paper, Classic Foil, Formless Foil, Orbital Color Match,
-- Stonefoil. This is true for ~99% of cards; documented exceptions
-- (some tokens, set-specific exclusions) are catalog-managed.
--
-- This migration:
--   1. Materializes Classic Foil / Formless Foil / Orbital Color Match /
--      Stonefoil rows for every Paper Wonders card not on the per-set
--      exception list. New rows get fresh UUIDs and copy all metadata
--      (hero_name, name, set_code, metadata JSONB, etc.).
--   2. Drops variant_harvest_seed — its prefix-based seeding is invalid
--      under the corrected model.
--   3. Clears Wonders price_cache / price_history /
--      ebay_listing_observations / ebay_card_images. The harvester
--      rebuilds them on the next run with correct (card_id, parallel)
--      keys. Pre-launch state means no users to inconvenience.
--
-- IDEMPOTENT. Safe to re-run. New rows insert via NOT EXISTS guard on
-- (game_id, card_number, parallel); existing rows are untouched.
--
-- Pre-launch context:
--   - No user collections exist yet — no FKs to migrate, no listings to
--     re-link, no scan_resolutions to repoint.
--   - Existing Wonders price data is regenerable in 2-3 harvest cycles.
--   - The discovery step (Phase 0 in the implementation doc) should run
--     BEFORE this migration to populate wonders_paper_only_exceptions.
--     Default: empty (every Wonders card gets all 5 parallels). Wrong-
--     row drift is acceptable pre-launch and corrected via direct
--     DELETE if discovered later.
--
-- Run BEFORE migration 31 (which depends on variant_harvest_seed being
-- gone) and BEFORE migration 33 (which adds the uniqueness constraint
-- this migration relies on conflict-checking against).

BEGIN;

-- ── Exception list: Wonders cards that should remain paper-only ────
-- Populate this BEFORE running the migration. Default: empty list →
-- every Paper Wonders card gets all 4 non-paper parallels generated.
-- If the user has a definitive list of paper-only cards (tokens, story
-- artifacts, set-specific exclusions), insert them here.
CREATE TEMP TABLE wonders_paper_only_exceptions (
  card_number text PRIMARY KEY
) ON COMMIT DROP;

-- Example (uncomment and edit if you have a confirmed list):
-- INSERT INTO wonders_paper_only_exceptions (card_number) VALUES
--   ('T-001'),
--   ('T-002'),
--   ('STORY-1');

-- ── Generate non-Paper parallel rows ───────────────────────────────
-- For every existing Wonders Paper row not in the exception list,
-- create rows for Classic Foil, Formless Foil, Orbital Color Match,
-- and Stonefoil. Copy all card metadata so each parallel row is a
-- complete catalog entry. image_url is intentionally left NULL for
-- non-Paper parallels — the harvester or admin upload populates over
-- time. Copying paper's image_url would mislead the UI into showing
-- a Paper render when the user owns a CF/FF/OCM/SF.
INSERT INTO public.cards (
  id,
  game_id,
  card_number,
  name,
  hero_name,
  athlete_name,
  set_code,
  power,
  rarity,
  weapon_type,
  battle_zone,
  image_url,
  year,
  parallel,
  metadata,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid()                AS id,
  c.game_id,
  c.card_number,
  c.name,
  c.hero_name,
  c.athlete_name,
  c.set_code,
  c.power,
  c.rarity,
  c.weapon_type,
  c.battle_zone,
  NULL                             AS image_url,
  c.year,
  v.parallel_name,
  c.metadata,
  now(),
  now()
FROM public.cards c
CROSS JOIN (VALUES
  ('Classic Foil'),
  ('Formless Foil'),
  ('Orbital Color Match'),
  ('Stonefoil')
) AS v(parallel_name)
WHERE c.game_id = 'wonders'
  AND c.parallel = 'Paper'
  AND c.card_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM wonders_paper_only_exceptions e
    WHERE e.card_number = c.card_number
  )
  AND NOT EXISTS (
    -- Idempotency guard: skip if a row for this (game_id, card_number,
    -- parallel) already exists. Catches partial prior runs and any
    -- admin-added rows that might pre-date the migration.
    SELECT 1 FROM public.cards c2
    WHERE c2.game_id = 'wonders'
      AND c2.card_number = c.card_number
      AND c2.parallel = v.parallel_name
  );

-- ── Drop the obsolete structural seed ──────────────────────────────
-- variant_harvest_seed was based on card-number-prefix → parallel
-- inference, which the corrected model invalidates. After the 5x
-- expansion above, every parallel that exists is its own cards row,
-- so the harvester reads (card_id, parallel) directly from cards. No
-- seed table needed.
--
-- CASCADE drops the RLS policy and any dependent objects. Migration 31
-- replaces the get_harvest_candidates RPC that referenced this table.
DROP TABLE IF EXISTS public.variant_harvest_seed CASCADE;

-- ── Clear stale Wonders price data ─────────────────────────────────
-- Pre-launch: no users to inconvenience. The harvester rebuilds these
-- with correct (card_id, parallel) keys on subsequent runs. Without
-- this clear, residual rows keyed by old card_ids would orphan-stick
-- around because the new RPC selects only from cards.
DELETE FROM public.price_cache pc
USING public.cards c
WHERE pc.card_id = c.id
  AND c.game_id = 'wonders';

DELETE FROM public.price_history ph
USING public.cards c
WHERE ph.card_id = c.id
  AND c.game_id = 'wonders';

-- Listing observations and image dedup tables are also keyed on
-- card_id; clear them so the harvester's post-fix repopulation isn't
-- mixed with stale entries.
DELETE FROM public.ebay_listing_observations elo
USING public.cards c
WHERE elo.card_id = c.id
  AND c.game_id = 'wonders';

DELETE FROM public.ebay_card_images eci
USING public.cards c
WHERE eci.card_id = c.id
  AND c.game_id = 'wonders';

-- ── Verify expected row counts ─────────────────────────────────────
-- Surfaces row counts in migration logs and aborts the transaction if
-- the expansion didn't produce the expected number of rows. The check
-- is paper_count_minus_exceptions × 4, since each non-paper parallel
-- gets one row per non-excepted paper card.
DO $$
DECLARE
  paper_count            int;
  cf_count               int;
  ff_count               int;
  ocm_count              int;
  sf_count               int;
  expected_per_parallel  int;
BEGIN
  SELECT count(*) INTO paper_count FROM public.cards
    WHERE game_id = 'wonders' AND parallel = 'Paper';
  SELECT count(*) INTO cf_count FROM public.cards
    WHERE game_id = 'wonders' AND parallel = 'Classic Foil';
  SELECT count(*) INTO ff_count FROM public.cards
    WHERE game_id = 'wonders' AND parallel = 'Formless Foil';
  SELECT count(*) INTO ocm_count FROM public.cards
    WHERE game_id = 'wonders' AND parallel = 'Orbital Color Match';
  SELECT count(*) INTO sf_count FROM public.cards
    WHERE game_id = 'wonders' AND parallel = 'Stonefoil';

  expected_per_parallel := paper_count - (
    SELECT count(*) FROM wonders_paper_only_exceptions
  );

  RAISE NOTICE 'Wonders parallel row counts after migration 30:';
  RAISE NOTICE '  Paper:               %', paper_count;
  RAISE NOTICE '  Classic Foil:        %  (expected: %)', cf_count, expected_per_parallel;
  RAISE NOTICE '  Formless Foil:       %  (expected: %)', ff_count, expected_per_parallel;
  RAISE NOTICE '  Orbital Color Match: %  (expected: %)', ocm_count, expected_per_parallel;
  RAISE NOTICE '  Stonefoil:           %  (expected: %)', sf_count, expected_per_parallel;

  IF cf_count <> expected_per_parallel
     OR ff_count <> expected_per_parallel
     OR ocm_count <> expected_per_parallel
     OR sf_count <> expected_per_parallel THEN
    RAISE EXCEPTION
      'Migration 30: row count mismatch — expected % rows per non-Paper parallel, got CF=%, FF=%, OCM=%, SF=%',
      expected_per_parallel, cf_count, ff_count, ocm_count, sf_count;
  END IF;
END $$;

COMMIT;
