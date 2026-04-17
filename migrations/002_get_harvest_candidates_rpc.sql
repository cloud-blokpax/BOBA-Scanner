-- Migration 2 — Update the harvester RPC
--
-- Replace get_harvest_candidates to (1) include variant_harvest_seed rows
-- and (2) exclude the paper variant for Wonders cards whose collector_number
-- implies a non-paper printing (A1- = OCM, P- = FF). Those paper rows are
-- always polluted because the variant-agnostic eBay query for a "paper"
-- version of an A1- collector number returns OCM listings.

CREATE OR REPLACE FUNCTION public.get_harvest_candidates(
  p_run_id text,
  p_limit  integer,
  p_game_id text DEFAULT 'boba'
)
RETURNS TABLE(
  id           text,
  hero_name    text,
  name         text,
  card_number  text,
  athlete_name text,
  parallel     text,
  weapon_type  text,
  variant      text,
  priority     integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH base_candidates AS (
    -- Paper variant for every card, EXCEPT Wonders A1- and P- cards
    -- (those printings are inherently OCM/FF, not paper).
    SELECT c.id, 'paper'::text AS variant
    FROM public.cards c
    WHERE c.game_id = p_game_id
      AND NOT (
        p_game_id = 'wonders'
        AND (c.card_number LIKE 'A1-%' OR c.card_number LIKE 'P-%')
      )

    UNION

    -- Structural seed rows (Wonders today; BoBA table is empty)
    SELECT vs.card_id, vs.variant
    FROM public.variant_harvest_seed vs
    INNER JOIN public.cards c ON c.id = vs.card_id
    WHERE c.game_id = p_game_id

    UNION

    -- Non-paper variants discovered via user collections
    SELECT coll.card_id, coll.variant
    FROM public.collections coll
    INNER JOIN public.cards c ON c.id = coll.card_id
    WHERE c.game_id = p_game_id AND coll.variant <> 'paper'

    UNION

    -- Non-paper variants discovered via user listing templates
    SELECT lt.card_id, lt.variant
    FROM public.listing_templates lt
    INNER JOIN public.cards c ON c.id = lt.card_id
    WHERE c.game_id = p_game_id
      AND lt.variant <> 'paper'
      AND lt.status IN ('draft','pending','published')
  ),
  with_flags AS (
    SELECT
      bc.id AS card_id,
      bc.variant,
      EXISTS (
        SELECT 1 FROM public.collections coll
        WHERE coll.card_id = bc.id AND coll.variant = bc.variant
      ) AS in_collection,
      pc.fetched_at,
      pc.price_mid,
      pc.listings_count
    FROM base_candidates bc
    LEFT JOIN public.price_cache pc
      ON pc.card_id = bc.id::uuid
     AND pc.source = 'ebay'
     AND pc.variant = bc.variant
  ),
  not_already_done AS (
    SELECT wf.*
    FROM with_flags wf
    WHERE NOT EXISTS (
      SELECT 1 FROM public.price_harvest_log phl
      WHERE phl.run_id = p_run_id
        AND phl.card_id::text = wf.card_id::text
        AND phl.variant = wf.variant
    )
  ),
  prioritized AS (
    SELECT
      nad.card_id,
      nad.variant,
      nad.in_collection,
      nad.fetched_at,
      CASE
        WHEN nad.fetched_at IS NULL THEN 1
        WHEN nad.price_mid IS NOT NULL
             AND nad.fetched_at < now() - interval '7 days'  THEN 2
        WHEN (nad.price_mid IS NULL OR coalesce(nad.listings_count,0) = 0)
             AND nad.fetched_at < now() - interval '14 days' THEN 3
        WHEN nad.price_mid IS NOT NULL THEN 4
        ELSE 5
      END AS priority
    FROM not_already_done nad
  )
  SELECT
    c.id::text,
    c.hero_name::text,
    c.name::text,
    c.card_number::text,
    c.athlete_name::text,
    c.parallel::text,
    c.weapon_type::text,
    p.variant::text,
    p.priority
  FROM prioritized p
  INNER JOIN public.cards c ON c.id = p.card_id
  WHERE p.priority IN (1, 2, 3)
  ORDER BY
    p.priority ASC,
    p.in_collection DESC,
    p.fetched_at ASC NULLS FIRST
  LIMIT p_limit;
$function$;

-- Smoke test: fresh run_id ensures nothing is filtered by price_harvest_log dedup.
-- Expected to return rows for cf, ff, ocm, and paper. If only paper, the seed
-- table isn't populated — re-run Migration 1.
-- SELECT variant, count(*) AS candidates
-- FROM public.get_harvest_candidates(
--   'dry-run-' || now()::text,
--   200,
--   'wonders'
-- )
-- GROUP BY variant
-- ORDER BY variant;
