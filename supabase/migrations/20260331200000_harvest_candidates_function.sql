-- ============================================================
-- get_harvest_candidates() — SQL-based prioritized card selection
-- ============================================================
-- Replaces the JS-side getPrioritizedCards() which hit the
-- Supabase client's 1,000-row default limit on large tables.
--
-- Priority order:
--   1 = In a user collection, no cached price
--   2 = In a user collection, stale price (>24h)
--   3 = Any card, no cached price
--   4 = Any card, stale price (>48h)
--
-- Cards already in price_harvest_log for today's run_id are excluded.

CREATE OR REPLACE FUNCTION get_harvest_candidates(
    p_run_id TEXT,
    p_limit  INT DEFAULT 9
)
RETURNS TABLE (
    id          TEXT,
    hero_name   TEXT,
    name        TEXT,
    card_number TEXT,
    priority    INT
)
LANGUAGE sql
STABLE
AS $$
    WITH already_done AS (
        -- Cards processed in this run (today). Index: idx_harvest_log_run
        SELECT DISTINCT card_id
        FROM price_harvest_log
        WHERE run_id = p_run_id
    ),
    collected AS (
        -- Distinct card_ids in any user's collection
        SELECT DISTINCT card_id
        FROM collections
    )
    SELECT
        c.id,
        c.hero_name,
        c.name,
        c.card_number,
        CASE
            WHEN col.card_id IS NOT NULL AND pc.card_id IS NULL
                THEN 1  -- collected + unpriced
            WHEN col.card_id IS NOT NULL AND pc.fetched_at < NOW() - INTERVAL '24 hours'
                THEN 2  -- collected + stale
            WHEN pc.card_id IS NULL
                THEN 3  -- any card + unpriced
            WHEN pc.fetched_at < NOW() - INTERVAL '48 hours'
                THEN 4  -- any card + stale
        END AS priority
    FROM cards c
    LEFT JOIN price_cache pc  ON pc.card_id = c.id AND pc.source = 'ebay'
    LEFT JOIN collected   col ON col.card_id = c.id
    LEFT JOIN already_done ad ON ad.card_id  = c.id
    WHERE ad.card_id IS NULL                        -- not yet processed today
      AND (
          (pc.card_id IS NULL)                      -- no price at all
          OR (col.card_id IS NOT NULL AND pc.fetched_at < NOW() - INTERVAL '24 hours')
          OR (pc.fetched_at < NOW() - INTERVAL '48 hours')
      )
    ORDER BY
        -- Priority bucket first
        CASE
            WHEN col.card_id IS NOT NULL AND pc.card_id IS NULL THEN 1
            WHEN col.card_id IS NOT NULL AND pc.fetched_at < NOW() - INTERVAL '24 hours' THEN 2
            WHEN pc.card_id IS NULL THEN 3
            WHEN pc.fetched_at < NOW() - INTERVAL '48 hours' THEN 4
        END ASC,
        -- Within a priority, oldest-fetched first (NULLs = never fetched = top)
        pc.fetched_at ASC NULLS FIRST
    LIMIT p_limit;
$$;

-- Composite index for the already_done CTE (run_id + card_id lookups)
CREATE INDEX IF NOT EXISTS idx_harvest_log_run_card
    ON public.price_harvest_log(run_id, card_id);
