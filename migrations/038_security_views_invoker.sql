-- 038_security_views_invoker.sql
--
-- Five Phase 2 telemetry views were created without `security_invoker`
-- and therefore ran with definer privileges, bypassing RLS on the tables
-- they read from. End users hitting these views would see rows from
-- other users' scans even though the underlying `scans` and
-- `scan_tier_results` tables have per-user RLS.
--
-- Flipping to `security_invoker = true` makes the view enforce the
-- caller's RLS context, restoring per-user scoping.
--
-- Views covered (all in public schema):
--   * tier1_card_level_v1
--   * tier1_hit_rate_v1
--   * scan_tier_results_live
--   * scan_pipeline_checkpoint_latest_v1
--   * scan_pipeline_checkpoint_full_v1
--
-- Applied directly to prod via Supabase MCP on 2026-04-30 under the name
-- `security_views_use_invoker_not_definer`. Recorded here so fresh
-- branches converge.

DO $$
DECLARE
  vw text;
BEGIN
  FOREACH vw IN ARRAY ARRAY[
    'tier1_card_level_v1',
    'tier1_hit_rate_v1',
    'scan_tier_results_live',
    'scan_pipeline_checkpoint_latest_v1',
    'scan_pipeline_checkpoint_full_v1'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = vw
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', vw);
    END IF;
  END LOOP;
END $$;
