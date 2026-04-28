-- Migration 31 — Replace get_harvest_candidates RPC (no seed UNION)
--
-- Migration 002's RPC UNIONed variant_harvest_seed onto cards to expose
-- (card_id, parallel) pairs the seed claimed existed by card-number
-- prefix inference. It also UNIONed collections and listing_templates
-- to discover user-owned non-paper variants.
--
-- After migration 30:
--   - The seed table is gone — its prefix-based inference was invalid.
--   - Every parallel that exists is its own cards row, so collections
--     and listing_templates can never reference a (card_id, parallel)
--     pair that isn't already in cards. The UNIONs were redundant.
--
-- The new RPC just selects from cards directly. The output column shape
-- is unchanged (id, hero_name, name, card_number, athlete_name,
-- card_parallel_name, weapon_type, parallel, priority, game_id, metadata)
-- so the consuming code in $lib/server/harvester/candidates.ts and
-- /api/cron/price-harvest needs no edits.

CREATE OR REPLACE FUNCTION public.get_harvest_candidates(
  p_run_id  text,
  p_limit   integer,
  p_game_id text DEFAULT 'boba'
)
RETURNS TABLE(
  id                  uuid,
  hero_name           text,
  name                text,
  card_number         text,
  athlete_name        text,
  card_parallel_name  text,
  weapon_type         text,
  parallel            text,
  priority            integer,
  game_id             text,
  metadata            jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      c.id,
      c.hero_name,
      c.name,
      c.card_number,
      c.athlete_name,
      c.parallel        AS card_parallel_name,
      c.weapon_type,
      c.parallel,
      c.game_id,
      c.metadata,
      pc.fetched_at,
      pc.price_mid,
      pc.listings_count,
      EXISTS (
        SELECT 1 FROM public.price_harvest_log phl
        WHERE phl.run_id   = p_run_id
          AND phl.card_id  = c.id
          AND phl.parallel = c.parallel
      ) AS already_run_today
    FROM public.cards c
    LEFT JOIN public.price_cache pc
      ON pc.card_id  = c.id
     AND pc.source   = 'ebay'
     AND pc.parallel = c.parallel
    WHERE c.game_id     = p_game_id
      AND c.card_number IS NOT NULL
      AND c.parallel    IS NOT NULL
  ),
  prioritized AS (
    SELECT
      b.*,
      CASE
        -- Never harvested → highest priority
        WHEN b.fetched_at IS NULL                                                       THEN 1
        -- Has a price but stale (>7 days) → refresh
        WHEN b.price_mid IS NOT NULL
             AND b.fetched_at < now() - interval '7 days'                               THEN 2
        -- Zero-result history but stale enough to retry (>14 days)
        WHEN (b.price_mid IS NULL OR coalesce(b.listings_count, 0) = 0)
             AND b.fetched_at < now() - interval '14 days'                              THEN 3
        -- Fresh price → only revisit when budget allows (skipped below)
        WHEN b.price_mid IS NOT NULL                                                    THEN 4
        ELSE 5
      END AS priority
    FROM base b
    WHERE NOT b.already_run_today
  )
  SELECT
    p.id,
    p.hero_name,
    p.name,
    p.card_number,
    p.athlete_name,
    p.card_parallel_name,
    p.weapon_type,
    p.parallel,
    p.priority,
    p.game_id,
    p.metadata
  FROM prioritized p
  WHERE p.priority IN (1, 2, 3)
  ORDER BY
    p.priority   ASC,
    p.fetched_at ASC NULLS FIRST,
    p.card_number ASC
  LIMIT p_limit;
$function$;

COMMENT ON FUNCTION public.get_harvest_candidates IS
  'Returns the next batch of (card_id, parallel) pairs for the price '
  'harvester. Replaces migration 002''s version which UNIONed the now-'
  'dropped variant_harvest_seed table plus collections/listing_templates. '
  'After Wonders 5x expansion (migration 30) every parallel exists as '
  'its own cards row, so the RPC just reads cards directly.';

GRANT EXECUTE ON FUNCTION public.get_harvest_candidates TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_harvest_candidates TO service_role;

-- Smoke test (commented). Fresh run_id ensures nothing is filtered by
-- price_harvest_log dedup. Expected: rows for all five parallels in
-- Wonders. If only Paper appears, migration 30 didn't expand the
-- catalog — re-run it.
--
-- SELECT parallel, count(*) AS candidates
-- FROM public.get_harvest_candidates(
--   'dry-run-' || now()::text,
--   500,
--   'wonders'
-- )
-- GROUP BY parallel
-- ORDER BY parallel;
