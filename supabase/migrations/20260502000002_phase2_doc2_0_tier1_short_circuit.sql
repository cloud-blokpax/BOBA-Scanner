-- Phase 2 Doc 2.0 — Pre-shutter consensus short-circuit.
-- Applied via Supabase MCP on 2026-05-02 prior to repo commit.

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS tier1_short_circuited boolean;

COMMENT ON COLUMN public.scans.tier1_short_circuited IS
  'Phase 2 Doc 2.0. TRUE when Tier 1 returned via the live-consensus short-circuit (skipped the canonical OCR pass). FALSE when canonical ran. NULL when Tier 1 did not run (legacy rows or live_ocr_tier1_v1 flag off).';

INSERT INTO public.feature_flags
  (feature_key, display_name, description, icon,
   enabled_globally, enabled_for_guest, enabled_for_authenticated,
   enabled_for_pro, enabled_for_admin)
VALUES
  ('phase2_short_circuit_v1',
   'Phase 2: Pre-Shutter Consensus Short-Circuit',
   'When live OCR reaches strong consensus (3+ agreement, summed confidence >= 2.5) AND catalog cross-validation passes BEFORE shutter, return the result immediately at capture instead of running the canonical OCR pass. Saves ~500-1500ms on the easy case. Doc 2.0.',
   '⚡', false, false, false, false, true)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  enabled_for_admin = EXCLUDED.enabled_for_admin;
