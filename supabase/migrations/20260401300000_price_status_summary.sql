-- ============================================================
-- get_price_status_summary() — price coverage breakdown by card type
-- ============================================================
-- Returns per-type counts of cards that:
--   has_price:          have a cached eBay price (price_mid IS NOT NULL)
--   searched_no_price:  were searched but had zero eBay results (row exists, price_mid IS NULL)
--   not_searched:       have never been looked up (no row in price_cache)

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
    WITH hero_counts AS (
        SELECT
            COUNT(*)                                                              AS total,
            COUNT(pc.card_id) FILTER (WHERE pc.price_mid IS NOT NULL)             AS has_price,
            COUNT(pc.card_id) FILTER (WHERE pc.card_id IS NOT NULL AND pc.price_mid IS NULL) AS searched_no_price
        FROM cards c
        LEFT JOIN price_cache pc ON pc.card_id = c.id AND pc.source = 'ebay'
    ),
    play_counts AS (
        SELECT
            COUNT(*)                                                              AS total,
            COUNT(pc.card_id) FILTER (WHERE pc.price_mid IS NOT NULL)             AS has_price,
            COUNT(pc.card_id) FILTER (WHERE pc.card_id IS NOT NULL AND pc.price_mid IS NULL) AS searched_no_price
        FROM play_cards p
        LEFT JOIN price_cache pc ON pc.card_id = p.id::TEXT AND pc.source = 'ebay'
        WHERE p.card_number LIKE 'PL-%' OR p.card_number LIKE 'BPL-%'
    ),
    hotdog_counts AS (
        SELECT
            COUNT(*)                                                              AS total,
            COUNT(pc.card_id) FILTER (WHERE pc.price_mid IS NOT NULL)             AS has_price,
            COUNT(pc.card_id) FILTER (WHERE pc.card_id IS NOT NULL AND pc.price_mid IS NULL) AS searched_no_price
        FROM play_cards p
        LEFT JOIN price_cache pc ON pc.card_id = p.id::TEXT AND pc.source = 'ebay'
        WHERE p.card_number LIKE 'HTD-%'
    )
    SELECT 'heroes'::TEXT,  has_price, searched_no_price, total - has_price - searched_no_price, total FROM hero_counts
    UNION ALL
    SELECT 'plays'::TEXT,   has_price, searched_no_price, total - has_price - searched_no_price, total FROM play_counts
    UNION ALL
    SELECT 'hotdogs'::TEXT, has_price, searched_no_price, total - has_price - searched_no_price, total FROM hotdog_counts;
$$;
