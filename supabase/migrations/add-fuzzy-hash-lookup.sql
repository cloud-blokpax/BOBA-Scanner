-- Fuzzy perceptual hash lookup using Hamming distance.
-- The phash column stores a 16-char hex string (64-bit dHash).
-- This function converts hex strings to bit strings and counts differing bits.
-- A threshold of 5 means "up to 5 bits different out of 64" ≈ 92% similar.

CREATE OR REPLACE FUNCTION find_similar_hash(
  query_hash TEXT,
  max_distance INT DEFAULT 5
)
RETURNS TABLE(phash TEXT, card_id UUID, confidence FLOAT, distance INT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    h.phash,
    h.card_id,
    h.confidence,
    -- Count differing bits between query hash and stored hash
    bit_count(
      ('x' || lpad(query_hash, 16, '0'))::bit(64)
      #  -- XOR operator
      ('x' || lpad(h.phash, 16, '0'))::bit(64)
    )::int AS distance
  FROM hash_cache h
  WHERE bit_count(
    ('x' || lpad(query_hash, 16, '0'))::bit(64)
    #
    ('x' || lpad(h.phash, 16, '0'))::bit(64)
  )::int <= max_distance
  ORDER BY distance ASC, h.confidence DESC
  LIMIT 1;
$$;
