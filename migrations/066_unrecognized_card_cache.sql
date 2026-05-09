-- Migration 066 — Unrecognized card number cache (Tier 2 negative cache)
--
-- When Tier 2 (Claude Haiku) returns a card number we DON'T have in our
-- catalog, we want to remember that for two reasons:
--   1. Don't pay Haiku again on the same unrecognized number for some
--      reasonable window (default 24h)
--   2. Surface "card numbers our users are scanning that we don't carry"
--      as a catalog-coverage signal
--
-- Keyed on (card_number_text, game_id) — not on image hash. The card
-- number is the canonical identity from Tier 2's perspective; physical
-- card hashes are local concerns owned by IDB.
--
-- Read path: SELECT 1 FROM unrecognized_card_cache
--            WHERE card_number = $1 AND game_id = $2
--              AND last_seen_at > now() - interval '24 hours'
--
-- Write path: ON CONFLICT (card_number, game_id) DO UPDATE SET
--               last_seen_at = now(),
--               occurrence_count = occurrence_count + 1
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.unrecognized_card_cache (
  card_number text NOT NULL,
  game_id text NOT NULL DEFAULT 'boba',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  -- Hero name from Haiku (when present), so we can surface "people are
  -- scanning a card called Foo with number X" without resolving X first.
  haiku_hero_name text,
  PRIMARY KEY (card_number, game_id)
);

-- Read pattern is "is this card_number in cache and still fresh"
CREATE INDEX IF NOT EXISTS unrecognized_card_cache_freshness_idx
  ON public.unrecognized_card_cache (card_number, game_id, last_seen_at DESC);

-- RLS — admin-only writes via service role; authenticated read is OK
-- (the data is "list of unrecognized card numbers" which is non-sensitive).
ALTER TABLE public.unrecognized_card_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY unrecognized_card_cache_authenticated_read
  ON public.unrecognized_card_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role bypasses RLS. No write policy = no writes from authenticated.

COMMENT ON TABLE public.unrecognized_card_cache IS
  'Tier 2 negative cache. When Haiku returns a card_number we don''t have, we remember it here to avoid repeat Haiku calls and to surface catalog gaps.';

-- Helper RPC — clean upsert from client code
CREATE OR REPLACE FUNCTION public.record_unrecognized_card(
  p_card_number text,
  p_game_id text DEFAULT 'boba',
  p_haiku_hero_name text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.unrecognized_card_cache
    (card_number, game_id, haiku_hero_name)
  VALUES (p_card_number, p_game_id, p_haiku_hero_name)
  ON CONFLICT (card_number, game_id) DO UPDATE SET
    last_seen_at = now(),
    occurrence_count = unrecognized_card_cache.occurrence_count + 1,
    haiku_hero_name = COALESCE(EXCLUDED.haiku_hero_name, unrecognized_card_cache.haiku_hero_name);
$$;

REVOKE ALL ON FUNCTION public.record_unrecognized_card(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_unrecognized_card(text, text, text) TO authenticated, service_role;
