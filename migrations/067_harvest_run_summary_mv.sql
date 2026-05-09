-- Migration 067 — Harvest run summary materialized view
--
-- Aggregates price_harvest_log by run_id to give a per-run summary view.
-- Replaces ad-hoc aggregation queries that scanned the full log table.
--
-- Refreshed at the end of each harvest run (see price-harvest/+server.ts
-- post-insert hook). REFRESH is fast (the underlying table is bounded
-- by recent harvest activity, ~150K rows steady state post-Phase 2 pruning).
--
-- Idempotent. Safe to re-run.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_harvest_runs AS
SELECT
  run_id,
  MIN(processed_at) AS started_at,
  MAX(processed_at) AS finished_at,
  EXTRACT(EPOCH FROM (MAX(processed_at) - MIN(processed_at)))::int AS duration_seconds,
  COUNT(*) AS cards_processed,
  COUNT(*) FILTER (WHERE success) AS cards_succeeded,
  COUNT(*) FILTER (WHERE NOT success) AS cards_failed,
  COUNT(*) FILTER (WHERE error_message IS NOT NULL) AS cards_with_errors,
  COUNT(*) FILTER (WHERE zero_results) AS cards_zero_results,
  COUNT(*) FILTER (WHERE price_changed) AS cards_price_changed,
  COUNT(*) FILTER (WHERE is_new_price) AS cards_new_price,
  COUNT(*) FILTER (WHERE threshold_rejected) AS cards_threshold_rejected,
  AVG(duration_ms)::int AS avg_card_duration_ms,
  MAX(duration_ms) AS max_card_duration_ms,
  SUM(ebay_results_raw) AS total_ebay_results_raw,
  SUM(listings_count) AS total_accepted_listings,
  SUM(filtered_count) AS total_filtered_listings,
  -- Game-level breakdown
  COUNT(*) FILTER (WHERE game_id = 'boba') AS boba_cards,
  COUNT(*) FILTER (WHERE game_id = 'wonders') AS wonders_cards,
  -- Most recent error message (useful for spot-check)
  (ARRAY_AGG(error_message ORDER BY processed_at DESC) FILTER (WHERE error_message IS NOT NULL))[1] AS most_recent_error
FROM public.price_harvest_log
GROUP BY run_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_harvest_runs_run_id_idx
  ON public.mv_harvest_runs (run_id);

CREATE INDEX IF NOT EXISTS mv_harvest_runs_started_at_idx
  ON public.mv_harvest_runs (started_at DESC);

-- Refresh function. Non-CONCURRENT (we learned in migration 059 that
-- CONCURRENT is too slow at scale, and admin tab has no traffic).
CREATE OR REPLACE FUNCTION public.refresh_harvest_runs()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.mv_harvest_runs;
END;
$$;

ALTER MATERIALIZED VIEW public.mv_harvest_runs OWNER TO postgres;
REVOKE ALL ON public.mv_harvest_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_harvest_runs TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_harvest_runs() TO service_role;

-- Initial population
REFRESH MATERIALIZED VIEW public.mv_harvest_runs;
