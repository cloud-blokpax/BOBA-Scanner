-- Migration 11 — Sunset legacy flag rows and tracing table (session 2.8)
--
-- Captures the post-deploy SQL from sessions 2.4 and 2.6 so fresh
-- Supabase branches converge to the same state as prod. All four
-- operations are already applied to prod via MCP; this file exists
-- only to bring `/migrations/` in sync with reality.
--
-- Idempotent by construction: DROP IF EXISTS is a no-op on a clean
-- schema, and DELETE against zero matching rows is a no-op.
--
-- Session 2.4 items:
--   - Drop scan_pipeline_trace (orphaned throwaway telemetry from
--     Session 1.1.1f/g; no consumers after 2.4).
--   - Delete feature_flags rows for the retired `embedding_tier1` and
--     `new_scan_pipeline` flags.
--   - Delete matching user_feature_overrides rows.
--
-- Session 2.6 items:
--   - Delete the `app_name` row from system_settings (orphaned after
--     app-name.ts removal; the Card Scanner default is now hard-coded).

BEGIN;

-- 2.4: scan_pipeline_trace drop
DROP TABLE IF EXISTS public.scan_pipeline_trace;

-- 2.4: zombie feature_flags rows
DELETE FROM public.feature_flags
WHERE feature_key IN ('embedding_tier1', 'new_scan_pipeline');

-- 2.4: zombie user_feature_overrides rows
DELETE FROM public.user_feature_overrides
WHERE feature_key IN ('embedding_tier1', 'new_scan_pipeline');

-- 2.6: orphaned system_settings row
DELETE FROM public.system_settings
WHERE key = 'app_name';

COMMIT;
