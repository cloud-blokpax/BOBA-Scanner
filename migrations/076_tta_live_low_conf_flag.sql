-- Phase 4 — feature flag gating TTA rescue for low-confidence live scans.
-- When ON, canonical hits between the 0.60 floor and 0.70 trigger TTA
-- voting; if TTA converges to a higher-confidence card, prefer it. If TTA
-- can't converge, restore canonical so we never regress vs pre-Phase-4.
-- Admin-only at launch; flip enabled_globally once Phase-1 fusion telemetry
-- confirms shutter quality is high enough that low-confidence canonicals
-- are rare AND distinct from canonical misses.
INSERT INTO feature_flags (
  feature_key, display_name, description,
  enabled_globally, enabled_for_guest, enabled_for_authenticated,
  enabled_for_member, enabled_for_admin, enabled_for_pro, icon
) VALUES (
  'tta_live_low_conf_v1',
  'TTA Rescue for Low-Confidence Live Scans (Phase 4)',
  'Runs TTA voting on live-camera scans whose canonical hit landed below 0.70 confidence (but above the 0.60 floor). If TTA converges to a higher-confidence card, prefer it; otherwise keep the canonical hit. Adds ~300 ms to qualifying scans (a minority).',
  false, false, false, false, true, false, '🎯'
)
ON CONFLICT (feature_key) DO NOTHING;
