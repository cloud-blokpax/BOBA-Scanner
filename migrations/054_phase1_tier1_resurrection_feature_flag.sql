-- Phase 1 Doc 1.2 — feature flag gating Tier 1 resurrection.
-- Enables canonical-path single-vote consensus acceptance and the new
-- 1st-edition-stamp-based Wonders parallel classifier. Admin-only at
-- launch; flip enabled_globally once telemetry confirms tier1_local_ocr
-- starts winning scans without regressing Haiku-fallback paths.
INSERT INTO feature_flags (
  feature_key, display_name, description,
  enabled_globally, enabled_for_guest, enabled_for_authenticated,
  enabled_for_member, enabled_for_admin, enabled_for_pro, icon
) VALUES (
  'phase1_tier1_resurrection_v1',
  'Phase 1: Tier 1 Resurrection (single-frame consensus + stamp classifier)',
  'Enables the canonical-path single-vote consensus acceptance fix and the new 1st-edition-stamp-based Wonders parallel classifier. Replaces the broken ff_no_border rule. Admin-only initial rollout.',
  false, false, false, false, true, false, '🎯'
)
ON CONFLICT (feature_key) DO NOTHING;
