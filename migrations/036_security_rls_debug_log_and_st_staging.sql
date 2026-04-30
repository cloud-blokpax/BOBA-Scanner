-- 036_security_rls_debug_log_and_st_staging.sql
--
-- Two tables had RLS off in prod, surfaced by the April 30 advisor sweep:
--
--   * `rls_debug_log` — captures raw JWT claims during RLS troubleshooting.
--     Without RLS this was readable by anon and would have leaked tokens
--     for any session that produced a debug row. The table is rarely used
--     in steady state but stays in the schema for ad-hoc debugging.
--
--   * `st_staging` — third-party pricing intelligence import staging
--     (used by `scripts/import-st-data.ts`). Pre-publish raw data; should
--     never be readable by end users.
--
-- Both are flipped to RLS-enabled fail-closed. service_role retains
-- access (bypasses RLS); no end-user policies are added because no
-- end-user code reads from either.
--
-- Applied directly to prod via Supabase MCP on 2026-04-30 under the name
-- `security_enable_rls_on_debug_and_staging_tables`. Recorded here so fresh
-- Supabase branches converge to the same state.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rls_debug_log'
  ) THEN
    EXECUTE 'ALTER TABLE public.rls_debug_log ENABLE ROW LEVEL SECURITY';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'st_staging'
  ) THEN
    EXECUTE 'ALTER TABLE public.st_staging ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
