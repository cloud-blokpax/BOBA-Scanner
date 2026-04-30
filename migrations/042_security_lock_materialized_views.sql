-- 042_security_lock_materialized_views.sql
--
-- Revoke SELECT on the two diagnostic materialized views from anon and
-- authenticated. Materialized views don't honor RLS, so granting them
-- to end-user roles exposes per-card coverage intelligence
-- (`mv_card_coverage`) and cross-user telemetry (`mv_scan_outcome_stats`)
-- that a competitor can scrape via the anon key.
--
-- App-side audit (April 30): no client or server code reads these MVs.
-- They are inspected ad-hoc in the Supabase dashboard and via service-role
-- queries; service_role retains SELECT regardless of grants. If a future
-- admin dashboard surfaces them, wrap each in a SECURITY DEFINER function
-- with an `is_admin` guard rather than re-granting the broad SELECT.

DO $$
DECLARE
  mv text;
BEGIN
  FOREACH mv IN ARRAY ARRAY['mv_card_coverage', 'mv_scan_outcome_stats']
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_matviews
      WHERE schemaname = 'public' AND matviewname = mv
    ) THEN
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', mv);
    END IF;
  END LOOP;
END $$;
