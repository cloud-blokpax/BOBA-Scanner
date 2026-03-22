-- Atomic hash cache upsert with scan_count increment
-- Prevents race condition where concurrent scans read-then-write the same count
CREATE OR REPLACE FUNCTION upsert_hash_cache(
    p_phash text,
    p_card_id text,
    p_confidence float,
    p_phash_256 text DEFAULT NULL
) RETURNS void AS $$
INSERT INTO hash_cache (phash, card_id, confidence, scan_count, last_seen, phash_256)
VALUES (p_phash, p_card_id, p_confidence, 1, NOW(), p_phash_256)
ON CONFLICT (phash) DO UPDATE SET
    card_id = EXCLUDED.card_id,
    confidence = EXCLUDED.confidence,
    scan_count = hash_cache.scan_count + 1,
    last_seen = NOW(),
    phash_256 = COALESCE(EXCLUDED.phash_256, hash_cache.phash_256);
$$ LANGUAGE sql;
