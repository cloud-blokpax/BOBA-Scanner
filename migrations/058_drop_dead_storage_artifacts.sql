-- Migration 058 — Drop dead storage artifacts
--
-- Three small cleanups, all dead code from Phase 2.5 and earlier:
--
-- 1. DROP TABLE hash_cache. The dHash/pHash Tier 1 cache was removed when
--    Phase 2.5 made the recognition pipeline OCR-first. Last write was
--    2026-04-27. Nothing reads it. ~2 MB.
--
-- 2. DROP FUNCTION mark_stale_ebay_listings(). Flipped a boolean
--    (ebay_card_images.is_active) that no app code, admin tab, or query
--    actually reads. The function ran daily for nothing.
--
-- 3. DROP COLUMN ebay_card_images.is_active. Same reason — unread flag.
--    Compacts ebay_card_images by ~1 byte per row × 54K rows ≈ 50 KB
--    plus the index gain.
--
-- Idempotent. Safe to re-run.

-- ── 1. Hash cache ───────────────────────────────────────────
-- Drop dependent functions first (upsert_hash_cache, upsert_hash_cache_v2)
DROP FUNCTION IF EXISTS public.upsert_hash_cache(uuid, bytea, bytea, integer, text);
DROP FUNCTION IF EXISTS public.upsert_hash_cache_v2(uuid, bytea, bytea, integer, text, text);
DROP TABLE IF EXISTS public.hash_cache CASCADE;

-- ── 2. Mark stale function ──────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_stale_ebay_listings();

-- ── 3. is_active column on ebay_card_images ─────────────────
-- The authenticated SELECT RLS policy filters on is_active. Drop and
-- recreate it without the predicate before removing the column.
DROP POLICY IF EXISTS ebay_card_images_authenticated_select ON public.ebay_card_images;

-- Drop any index on is_active first
DO $$
DECLARE
  idx record;
BEGIN
  FOR idx IN
    SELECT i.relname AS index_name
    FROM pg_class i
    JOIN pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE t.relname = 'ebay_card_images'
      AND a.attname = 'is_active'
      AND i.relkind = 'i'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', idx.index_name);
  END LOOP;
END $$;

ALTER TABLE public.ebay_card_images DROP COLUMN IF EXISTS is_active;

-- Recreate the authenticated SELECT policy with no is_active predicate
-- (since we never read the flag anyway, all rows are visible).
CREATE POLICY ebay_card_images_authenticated_select ON public.ebay_card_images
  FOR SELECT TO authenticated USING (true);
