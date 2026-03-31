-- ============================================================
-- Update get_harvest_candidates() to include play cards
-- ============================================================
-- Adds play_cards to the candidate pool by converting them to the
-- same shape (id, hero_name, name, card_number) expected by the
-- harvester. Play cards use their UUID id and name as hero_name.
--
-- Priority follows the same rules: collected+unpriced first, etc.
-- Play cards use card_number as the primary search term since
-- sellers list by play name + number.

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
        SELECT DISTINCT card_id
        FROM price_harvest_log
        WHERE run_id = p_run_id
    ),
    collected AS (
        SELECT DISTINCT card_id
        FROM collections
    ),
    -- Hero cards (existing logic)
    hero_candidates AS (
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
        WHERE ad.card_id IS NULL
          AND (
              (pc.card_id IS NULL)
              OR (col.card_id IS NOT NULL AND pc.fetched_at < NOW() - INTERVAL '24 hours')
              OR (pc.fetched_at < NOW() - INTERVAL '48 hours')
          )
    ),
    -- Play cards (new — unioned into candidate pool)
    play_candidates AS (
        SELECT
            p.id::TEXT AS id,
            p.name AS hero_name,
            p.name,
            p.card_number,
            CASE
                WHEN pc.card_id IS NULL
                    THEN 3  -- unpriced play
                WHEN pc.fetched_at < NOW() - INTERVAL '48 hours'
                    THEN 4  -- stale play
            END AS priority
        FROM play_cards p
        LEFT JOIN price_cache pc  ON pc.card_id = p.id::TEXT AND pc.source = 'ebay'
        LEFT JOIN already_done ad ON ad.card_id  = p.id::TEXT
        WHERE ad.card_id IS NULL
          AND (
              (pc.card_id IS NULL)
              OR (pc.fetched_at < NOW() - INTERVAL '48 hours')
          )
    ),
    all_candidates AS (
        SELECT * FROM hero_candidates
        UNION ALL
        SELECT * FROM play_candidates
    )
    SELECT id, hero_name, name, card_number, priority
    FROM all_candidates
    WHERE priority IS NOT NULL
    ORDER BY priority ASC, card_number ASC NULLS LAST
    LIMIT p_limit;
$$;
