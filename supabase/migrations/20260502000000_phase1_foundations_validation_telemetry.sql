-- Phase 1 — Foundations: Trustworthy Tier 1
-- Adds telemetry columns + feature flags for catalog cross-validation,
-- vocabulary correction, and orientation correction.

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS catalog_validation_passed boolean,
  ADD COLUMN IF NOT EXISTS catalog_validation_failure_reason text
    CHECK (catalog_validation_failure_reason IS NULL OR catalog_validation_failure_reason IN (
      'no_catalog_match',
      'card_number_name_mismatch',
      'parallel_mismatch',
      'multiple_match_ambiguous',
      'name_only_no_card_number',
      'card_number_only_no_name'
    )),
  ADD COLUMN IF NOT EXISTS orientation_correction_deg smallint
    CHECK (orientation_correction_deg IS NULL OR orientation_correction_deg IN (0, 90, 180, 270));

COMMENT ON COLUMN public.scans.catalog_validation_passed IS
  'Phase 1 Doc 1.0. TRUE iff Tier 1 OCR produced (card_number, name) AND the resulting cards row was unique. FALSE = OCR fields contradicted catalog → forced fallback. NULL = validation did not run (legacy rows or feature flag off).';

COMMENT ON COLUMN public.scans.catalog_validation_failure_reason IS
  'Phase 1 Doc 1.0. When catalog_validation_passed=false, why. Used to drive future tuning of the consensus thresholds and vocabulary correction.';

COMMENT ON COLUMN public.scans.orientation_correction_deg IS
  'Phase 1 Doc 1.2. Degrees of rotation applied to the canonical bitmap before OCR. 0 = none. 90/180/270 = corrected from EXIF or confidence-retry. NULL = pre-Phase-1 row.';

-- Feature flags. Three rows so each sub-doc can be rolled forward/back independently.
INSERT INTO public.feature_flags
  (feature_key, display_name, description, icon,
   enabled_globally, enabled_for_guest, enabled_for_authenticated,
   enabled_for_pro, enabled_for_admin)
VALUES
  ('phase1_orientation_correction_v1',
   'Phase 1: Orientation Correction',
   'Applies EXIF orientation to uploads before Tier 1 OCR; runs a 180° retry pass on uploads where both card_number and name region OCR fall below the confidence floor. Doc 1.2.',
   '🔄', false, false, false, false, true),
  ('phase1_vocab_correction_v1',
   'Phase 1: Vocabulary Correction',
   'Edit-distance-1 correction of card_number prefix against the closed BoBA prefix vocabulary; tightened name shortlist matching for short hero names. Doc 1.1.',
   '🔤', false, false, false, false, true),
  ('phase1_catalog_validation_v1',
   'Phase 1: Catalog Cross-Validation Gate',
   'Strict triangulation: Tier 1 only accepts a result when (card_number, name, parallel) resolves to exactly one cards row. Contradictions force fallback to Haiku. Doc 1.0.',
   '✅', false, false, false, false, true)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  enabled_for_admin = EXCLUDED.enabled_for_admin;
