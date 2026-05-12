
-- A single lowercase 'paper' row in collections previously caused the RPC's
-- case-sensitive comparisons (NOT EXISTS dedup against phl, LEFT JOIN to pc)
-- to silently fail, returning the same Wonders card 288 times/day for 10 days.
-- Constraints now prevent lowercase 'paper' specifically, but ANY future
-- contamination ('battlefoil' instead of 'Battlefoil') would cause the same
-- pathology. Defense in depth: make the joins case-insensitive.
CREATE OR REPLACE FUNCTION public.get_harvest_candidates(p_run_id text, p_limit integer, p_game_id text DEFAULT 'boba'::text)
 RETURNS TABLE(id text, hero_name text, name text, card_number text, athlete_name text, card_parallel_name text, weapon_type text, parallel text, priority integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base_candidates AS (
    SELECT c.id, c.parallel
    FROM public.cards c
    WHERE c.game_id = p_game_id
      AND c.parallel IS NOT NULL
      AND c.parallel <> 'Superfoil'
      AND c.parallel NOT ILIKE '%Superfoil'
    UNION
    SELECT c.id, coll.parallel
    FROM public.collections coll
    INNER JOIN public.cards c ON c.id = coll.card_id
    WHERE c.game_id = p_game_id
      AND coll.parallel IS NOT NULL
      AND coll.parallel <> 'Superfoil'
      AND coll.parallel NOT ILIKE '%Superfoil'
    UNION
    SELECT c.id, COALESCE(lt.parallel, c.parallel)
    FROM public.listing_templates lt
    INNER JOIN public.cards c ON c.id = lt.card_id
    WHERE c.game_id = p_game_id
      AND lt.status IN ('draft','pending','published')
      AND COALESCE(lt.parallel, c.parallel) <> 'Superfoil'
      AND COALESCE(lt.parallel, c.parallel) NOT ILIKE '%Superfoil'
  ),
  with_flags AS (
    SELECT bc.id AS card_id, bc.parallel,
      EXISTS (
        SELECT 1 FROM public.collections coll
        WHERE coll.card_id = bc.id AND LOWER(coll.parallel) = LOWER(bc.parallel)
      ) AS in_collection,
      pc.fetched_at
    FROM base_candidates bc
    LEFT JOIN public.price_cache pc
      ON pc.card_id = bc.id::uuid
     AND pc.source = 'ebay'
     AND LOWER(pc.parallel) = LOWER(bc.parallel)
  ),
  not_already_done AS (
    SELECT wf.*
    FROM with_flags wf
    WHERE NOT EXISTS (
      SELECT 1 FROM public.price_harvest_log phl
      WHERE phl.run_id = p_run_id
        AND phl.card_id::text = wf.card_id::text
        AND LOWER(phl.parallel) = LOWER(wf.parallel)
    )
  ),
  prioritized AS (
    SELECT nad.*,
      CASE
        WHEN nad.fetched_at IS NULL                                   THEN 1
        WHEN nad.fetched_at < now() - interval '7 days'               THEN 2
        ELSE 9
      END AS priority
    FROM not_already_done nad
  )
  SELECT
    c.id::text,
    c.hero_name::text,
    c.name::text,
    c.card_number::text,
    c.athlete_name::text,
    c.parallel::text AS card_parallel_name,
    c.weapon_type::text,
    p.parallel::text,
    p.priority
  FROM prioritized p
  INNER JOIN public.cards c ON c.id = p.card_id
  WHERE p.priority < 9
  ORDER BY
    p.priority ASC,
    p.in_collection DESC,
    p.fetched_at ASC NULLS FIRST
  LIMIT p_limit;
$function$;
