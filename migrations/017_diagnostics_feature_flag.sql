-- Migration 17 — diagnostics_v1 feature flag
--
-- Gates the new logEvent → app_events pipeline. Admin-only at launch
-- so we can validate the system before opening it up.
--
-- Idempotent.

BEGIN;

INSERT INTO public.feature_flags
  (feature_key, display_name, description, icon,
   enabled_globally, enabled_for_guest, enabled_for_authenticated,
   enabled_for_pro, enabled_for_admin)
VALUES
  (
    'diagnostics_v1',
    'Diagnostic Logging v1',
    'Enables the unified app_events logging pipeline. When ON, errors and warnings get persisted to the app_events table with auto-fingerprinting and triage. When OFF, falls back to the legacy console-only behavior.',
    '🔬',
    false, false, false, false, true
  )
ON CONFLICT (feature_key) DO NOTHING;

COMMIT;
