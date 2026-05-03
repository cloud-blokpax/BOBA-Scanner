-- Phase 2 Doc 2.6 — observable Tier 1 invocation flag.
-- Lets us tell whether runTier1 was reached on a given scan, independent
-- of whether Tier 1 succeeded or whether decision_context survived.

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS tier1_attempted boolean;

COMMENT ON COLUMN public.scans.tier1_attempted IS
  'Phase 2 Doc 2.6. TRUE when runTier1() was invoked for this scan (regardless of whether canonical succeeded, the short-circuit fired, or it fell through to Tier 2). FALSE when Tier 1 was skipped (live_ocr_tier1_v1 flag off, or pre-Tier-1 abort). NULL on legacy rows.';
