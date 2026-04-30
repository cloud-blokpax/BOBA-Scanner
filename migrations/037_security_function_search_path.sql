-- 037_security_function_search_path.sql
--
-- Pin search_path on three SECURITY DEFINER functions that the advisor
-- flagged for missing `SET search_path`. Without an explicit search_path,
-- a function executes against whatever search_path the caller sets — a
-- malicious caller could shadow `public.cards` with their own table by
-- prepending a schema. Pinning to `public, pg_catalog` makes the function
-- deterministic and resilient to that class of attack.
--
-- Functions covered:
--   * mark_stale_ebay_listings — daily cleanup cron entrypoint
--   * set_photo_retention_until — TRIGGER on scans insert
--   * prune_old_observations — observation table maintenance cron
--
-- Applied directly to prod via Supabase MCP on 2026-04-30 under the name
-- `security_fix_function_search_path`. Recorded here so fresh branches
-- converge.

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'mark_stale_ebay_listings',
        'set_photo_retention_until',
        'prune_old_observations'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_catalog',
      fn.nspname, fn.proname, fn.args
    );
  END LOOP;
END $$;
