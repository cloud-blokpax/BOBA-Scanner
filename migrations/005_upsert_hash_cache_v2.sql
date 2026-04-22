-- Migration 5 — Source-aware hash_cache upsert RPC
--
-- Session 1.3: closes the BoBA cold-start hash_cache gap.
--
-- The existing upsert_hash_cache stays untouched (user scan path). This v2
-- variant is used by the harvester image piggyback (src/lib/services/
-- image-harvester.ts) and the one-shot backfill (scripts/backfill-boba-
-- hashes.ts). It accepts a `source` argument and does ON CONFLICT DO NOTHING,
-- so harvester seeds never stomp user-confirmed entries.
--
-- The hash_source enum already contains 'ebay_seed' — verified in prod.

CREATE OR REPLACE FUNCTION public.upsert_hash_cache_v2(
    p_phash      text,
    p_card_id    uuid,
    p_phash_256  text              DEFAULT NULL,
    p_game_id    text              DEFAULT 'boba',
    p_variant    text              DEFAULT 'paper',
    p_source     hash_source       DEFAULT 'ebay_seed',
    p_confidence double precision  DEFAULT 1.0
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    WITH ins AS (
        INSERT INTO public.hash_cache (
            phash, card_id, confidence, phash_256,
            game_id, variant, source, scan_count, last_seen, created_at
        )
        VALUES (
            p_phash, p_card_id, p_confidence, p_phash_256,
            p_game_id, p_variant, p_source, 0, NOW(), NOW()
        )
        ON CONFLICT (phash) DO NOTHING
        RETURNING 1
    )
    SELECT EXISTS (SELECT 1 FROM ins);
$$;

COMMENT ON FUNCTION public.upsert_hash_cache_v2 IS
  'Source-aware hash_cache upsert. Returns true if inserted, false if phash already present.
   Used by price-harvest image piggyback and one-shot backfills. Does NOT overwrite
   existing rows — user-submitted hashes always win.';

GRANT EXECUTE ON FUNCTION public.upsert_hash_cache_v2 TO service_role;
