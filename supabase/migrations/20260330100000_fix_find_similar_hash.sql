-- Fix find_similar_hash to handle rows with non-16-char hex phash values
-- (e.g., 256-bit hashes stored in phash column) that cannot be cast to BIT(64).
-- Also validates the input query_hash before attempting the cast.

CREATE OR REPLACE FUNCTION public.find_similar_hash(
    query_hash TEXT,
    max_distance INT DEFAULT 5
)
RETURNS TABLE (
    phash      TEXT,
    card_id    UUID,
    confidence DOUBLE PRECISION,
    scan_count INT,
    phash_256  TEXT,
    distance   INT
) AS $$
BEGIN
    -- Validate input: must be exactly 16 hex characters for BIT(64) cast
    IF query_hash IS NULL OR length(query_hash) != 16 OR query_hash !~ '^[0-9a-fA-F]{16}$' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        h.phash,
        h.card_id,
        h.confidence,
        h.scan_count,
        bit_count(('x' || h.phash)::BIT(64) # ('x' || query_hash)::BIT(64))::INT AS distance
    FROM public.hash_cache h
    WHERE length(h.phash) = 16
      AND h.phash ~ '^[0-9a-fA-F]{16}$'
      AND bit_count(('x' || h.phash)::BIT(64) # ('x' || query_hash)::BIT(64))::INT <= max_distance
    ORDER BY distance ASC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql STABLE;
