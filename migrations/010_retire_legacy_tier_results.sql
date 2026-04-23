-- Migration 10 — Retire legacy Tier 1/2 engine rows (session 2.5 followup)
--
-- Session 2.5 removed runTier1 (pHash) and runTier2 (Tesseract) from the
-- scan pipeline. Historical scan_tier_results rows with those engines
-- remain in the table but should be excluded from new dashboards.
--
-- This migration tags those rows in capture_context and creates a
-- filtering view. Safe to re-run — the UPDATE short-circuits on rows
-- that already carry the tier_retired_in_session key, and the view is
-- CREATE OR REPLACE.

BEGIN;

UPDATE public.scan_tier_results
SET capture_context = COALESCE(capture_context, '{}'::jsonb)
  || jsonb_build_object(
       'tier_retired_in_session', '2.5',
       'tier_retired_at', NOW()::text
     )
WHERE engine IN ('phash', 'dhash', 'tesseract_v5')
  AND (capture_context->>'tier_retired_in_session') IS NULL;

CREATE OR REPLACE VIEW public.scan_tier_results_live AS
SELECT *
FROM public.scan_tier_results
WHERE engine NOT IN ('phash', 'dhash', 'tesseract_v5')
   OR (capture_context->>'tier_retired_in_session') IS NULL;

COMMIT;
