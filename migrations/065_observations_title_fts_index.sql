-- Migration 065 — Full-text search index on ebay_listing_observations.title
--
-- Enables fast ILIKE-style searches over titles for filter diagnosis,
-- title corpus analysis (Quick List feature prep), and condition keyword
-- inference. GIN index over to_tsvector — handles word-boundary search
-- much faster than seq scan + ILIKE.
--
-- Use case examples:
--   SELECT COUNT(*) FROM ebay_listing_observations
--   WHERE to_tsvector('english', title) @@ to_tsquery('graded & psa');
--
--   SELECT card_id, COUNT(*)
--   FROM ebay_listing_observations
--   WHERE to_tsvector('english', title) @@ to_tsquery('crossbow')
--   GROUP BY card_id ORDER BY 2 DESC;
--
-- Build is non-CONCURRENT here because the table is admin-RLS — no user
-- queries are blocked during the build. Build time on 175K rows: ~3-5 sec.

CREATE INDEX IF NOT EXISTS ebay_listing_obs_title_fts_idx
  ON public.ebay_listing_observations
  USING GIN (to_tsvector('english', title));
