-- Migration 060 — Drop find_similar_hash().
--
-- The function body queries the dropped hash_cache table (migration 058).
-- Calls to it now error out. Only caller was overlay-price-lookup.ts which
-- this branch removes.
--
-- Idempotent. Safe to re-run.

DROP FUNCTION IF EXISTS public.find_similar_hash(text, integer, text);
DROP FUNCTION IF EXISTS public.find_similar_hash(text, integer);
