-- ============================================================
-- get_price_status_summary() — price coverage breakdown by card type
-- ============================================================
-- Returns per-type counts of cards that:
--   has_price:          have a cached eBay price (price_mid IS NOT NULL)
--   searched_no_price:  were searched but no usable price (zero results, threshold-rejected, or null price)
--   not_searched:       have never been looked up (no row in price_cache or harvest log)
--
-- A card counts as "searched" if it appears in EITHER price_cache OR
-- price_harvest_log, since the harvester's confidence threshold may
-- reject prices (writing only to harvest log, not price_cache).

CREATE OR REPLACE FUNCTION get_price_status_summary()
RETURNS TABLE (
    card_type          TEXT,
    has_price          BIGINT,
    searched_no_price  BIGINT,
    not_searched       BIGINT,
    total              BIGINT
)
LANGUAGE sql
STABLE
AS $$
    -- Distinct card_ids that appear in harvest log (includes threshold-rejected)
    WITH harvested AS (
        SELECT DISTINCT card_id FROM price_harvest_log
    ),
    hero_counts AS (
        SELECT
            COUNT(*)                                                              AS total,
            COUNT(*) FILTER (WHERE pc.price_mid IS NOT NULL)                      AS has_price,
            COUNT(*) FILTER (WHERE pc.price_mid IS NULL AND (pc.card_id IS NOT NULL OR h.card_id IS NOT NULL)) AS searched_no_price
        FROM cards c
        LEFT JOIN price_cache pc  ON pc.card_id = c.id AND pc.source = 'ebay'
        LEFT JOIN harvested h     ON h.card_id  = c.id
    ),
    play_counts AS (
        SELECT
            COUNT(*)                                                              AS total,
            COUNT(*) FILTER (WHERE pc.price_mid IS NOT NULL)                      AS has_price,
            COUNT(*) FILTER (WHERE pc.price_mid IS NULL AND (pc.card_id IS NOT NULL OR h.card_id IS NOT NULL)) AS searched_no_price
        FROM play_cards p
        LEFT JOIN price_cache pc  ON pc.card_id = p.id::TEXT AND pc.source = 'ebay'
        LEFT JOIN harvested h     ON h.card_id  = p.id::TEXT
        WHERE p.card_number LIKE 'PL-%' OR p.card_number LIKE 'BPL-%'
    ),
    hotdog_counts AS (
        SELECT
            COUNT(*)                                                              AS total,
            COUNT(*) FILTER (WHERE pc.price_mid IS NOT NULL)                      AS has_price,
            COUNT(*) FILTER (WHERE pc.price_mid IS NULL AND (pc.card_id IS NOT NULL OR h.card_id IS NOT NULL)) AS searched_no_price
        FROM play_cards p
        LEFT JOIN price_cache pc  ON pc.card_id = p.id::TEXT AND pc.source = 'ebay'
        LEFT JOIN harvested h     ON h.card_id  = p.id::TEXT
        WHERE p.card_number LIKE 'HTD-%'
    )
    SELECT 'heroes'::TEXT,  has_price, searched_no_price, total - has_price - searched_no_price, total FROM hero_counts
    UNION ALL
    SELECT 'plays'::TEXT,   has_price, searched_no_price, total - has_price - searched_no_price, total FROM play_counts
    UNION ALL
    SELECT 'hotdogs'::TEXT, has_price, searched_no_price, total - has_price - searched_no_price, total FROM hotdog_counts;
$$;
