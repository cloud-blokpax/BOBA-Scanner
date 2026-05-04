-- Phase 1 Doc 1.1 — Tier 2 catalog cross-validation gate.

ALTER TABLE scans ADD COLUMN tier2_validation_passed boolean;
COMMENT ON COLUMN scans.tier2_validation_passed IS
  'Phase 1 Doc 1.1: catalog cross-validation outcome on the Tier 2 (Haiku) match. NULL when the gate did not run (flag off, or Tier 2 did not produce a match).';

ALTER TABLE scans ADD COLUMN tier2_validation_failure_reason text;
COMMENT ON COLUMN scans.tier2_validation_failure_reason IS
  'Phase 1 Doc 1.1: reason from validateCatalogTriangulation when tier2_validation_passed=false. NULL otherwise.';

ALTER TABLE scans ADD COLUMN tier2_validation_gated boolean;
COMMENT ON COLUMN scans.tier2_validation_gated IS
  'Phase 1 Doc 1.1: TRUE when validation failed AND Haiku collector_number_confidence was high enough that we abandoned the match. FALSE when validation failed but Haiku confidence was low (we let the candidate through). NULL when validation passed or did not run.';

CREATE INDEX IF NOT EXISTS idx_scans_tier2_validation_gated
  ON scans (tier2_validation_gated)
  WHERE tier2_validation_gated IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scans_tier2_validation_failure_reason
  ON scans (tier2_validation_failure_reason)
  WHERE tier2_validation_failure_reason IS NOT NULL;

INSERT INTO feature_flags (
  feature_key, display_name, description,
  enabled_globally, enabled_for_guest, enabled_for_authenticated,
  enabled_for_member, enabled_for_admin, enabled_for_pro, icon
) VALUES (
  'phase1_tier2_validation_v1',
  'Phase 1: Tier 2 (Haiku) Catalog Validation Gate',
  'Re-runs catalog cross-validation on Tier 2 matches. Abandons commits when Haiku''s card_number disagrees with the matched candidate AND Haiku''s collector_number_confidence >= 0.8. Prevents name-only fallback from picking the wrong printing.',
  false, false, false, false, true, false, '🛡️'
)
ON CONFLICT (feature_key) DO NOTHING;
