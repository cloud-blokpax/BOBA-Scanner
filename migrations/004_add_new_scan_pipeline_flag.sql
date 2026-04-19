-- Migration 4 — Add the `new_scan_pipeline` feature flag for Phase 0.3 rollout.
--
-- Gates the new client-side scan-writer (src/lib/services/scan-writer.ts) that
-- persists to the 6-table scan-history schema shipped in Phase 0.1/0.2.
--
-- Default OFF globally. Admin-only for initial verification. After 48h of
-- clean production rows, flip to enabled_for_authenticated = true.
--
-- Idempotent on re-run via ON CONFLICT DO NOTHING.

INSERT INTO public.feature_flags (
	feature_key,
	display_name,
	description,
	icon,
	enabled_globally,
	enabled_for_guest,
	enabled_for_authenticated,
	enabled_for_pro,
	enabled_for_admin
)
VALUES (
	'new_scan_pipeline',
	'New Scan Pipeline (Phase 0.3)',
	'Persist scans to the new 6-table schema (scan_sessions, scans, scan_tier_results). Replaces the legacy logScanToSupabase path. Admin-only during verification; flip to authenticated after 48h of clean production rows.',
	'🔬',
	false,
	false,
	false,
	false,
	true
)
ON CONFLICT (feature_key) DO NOTHING;

-- Verification — should return one row with admin-only enablement
SELECT feature_key, enabled_globally, enabled_for_guest, enabled_for_authenticated,
       enabled_for_pro, enabled_for_admin
FROM public.feature_flags
WHERE feature_key = 'new_scan_pipeline';
