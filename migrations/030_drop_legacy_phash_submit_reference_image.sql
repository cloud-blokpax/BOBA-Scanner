-- Drop the legacy 7-arg `submit_reference_image` overload that includes
-- `p_phash`. The two overloads (6-arg without phash, 7-arg with phash) made
-- PostgREST return 503 "Could not choose the best candidate function" because
-- the call shape from the client was ambiguous. The phash-based Tier 1 path
-- was retired in Session 2.5 (recognition pipeline is now PaddleOCR + Claude
-- Haiku only); the phash overload was never invoked by live code anymore.
--
-- Keep the canonical 6-arg overload:
--   submit_reference_image(
--     p_card_id text, p_image_path text, p_confidence real,
--     p_user_id uuid, p_user_name text, p_blur_variance real
--   )
--
-- Already applied to prod via Supabase MCP before this file was committed —
-- this migration records the state so fresh Supabase branches converge to it.

drop function if exists public.submit_reference_image(
  p_card_id text,
  p_image_path text,
  p_confidence double precision,
  p_phash text,
  p_user_id uuid,
  p_user_name text,
  p_blur_variance double precision
);
