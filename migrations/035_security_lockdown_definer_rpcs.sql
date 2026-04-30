-- 035_security_lockdown_definer_rpcs.sql
--
-- Lock down EXECUTE on SECURITY DEFINER functions that should never be
-- callable by anonymous or authenticated end-user roles. Discovered during
-- the April 30 security advisor pass: `activate_pro` was the most dangerous
-- — anyone with an anon key could flip themselves to Pro by calling the
-- payment-bypass primitive. The cron/admin RPCs were less severe but
-- still leaked privileged metrics or allowed write-side effects without
-- an admin guard.
--
-- service_role retains EXECUTE (it bypasses RLS regardless). The cron and
-- admin endpoints already use service_role for these calls, so the revoke
-- is non-breaking.
--
-- Applied directly to prod via Supabase MCP on 2026-04-30 under the name
-- `security_lockdown_activate_pro_and_server_only_rpcs`. Recorded here so
-- fresh Supabase branches converge to the same state when run in order.

-- Payment bypass primitive: revoke from public-facing roles.
REVOKE EXECUTE ON FUNCTION public.activate_pro(uuid, text, numeric, text, integer) FROM anon, authenticated;

-- Cron / admin-only SECURITY DEFINER functions: server-side only.
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
        'purge_old_app_events',
        'app_events_storage_summary',
        'event_known_patterns',
        'mark_stale_ebay_listings',
        'prune_old_observations',
        'get_harvest_summary',
        'get_price_status_summary',
        'get_latest_harvest_per_card',
        'refresh_scan_history_mvs',
        'get_daily_trends'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anon, authenticated',
      fn.nspname, fn.proname, fn.args
    );
  END LOOP;
END $$;
