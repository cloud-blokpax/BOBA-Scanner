-- Migration 10 — Retire legacy Tier 1/2 engine rows (session 2.5 followup)
--
-- Session 2.5 removed runTier1 (pHash) and runTier2 (Tesseract) from the
-- scan pipeline. Historical scan_tier_results rows with those engines
-- remain in the table but should be excluded from new dashboards.
--
-- This migration tags those rows in the existing `extras` jsonb column
-- and creates a filtering view. Safe to re-run — the UPDATE short-
-- circuits on rows that already carry the tier_retired_in_session key,
-- and the view is CREATE OR REPLACE.
--
-- NOTE (session 2.8): the original draft of this file referenced a
-- `capture_context` column that does not exist on scan_tier_results.
-- Prod was patched directly via MCP using `extras`; this file is the
-- corrected canonical SQL so fresh Supabase branches converge to the
-- same state.

BEGIN;

UPDATE public.scan_tier_results
SET extras = COALESCE(extras, '{}'::jsonb)
  || jsonb_build_object(
       'tier_retired_in_session', '2.5',
       'tier_retired_at', NOW()::text
     )
WHERE engine IN ('phash', 'dhash', 'tesseract_v5')
  AND NOT (extras ? 'tier_retired_in_session');

CREATE OR REPLACE VIEW public.scan_tier_results_live AS
SELECT *
FROM public.scan_tier_results
WHERE engine NOT IN ('phash', 'dhash', 'tesseract_v5')
   OR NOT (extras ? 'tier_retired_in_session');

COMMIT;
