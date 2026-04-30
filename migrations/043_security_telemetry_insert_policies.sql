-- 043_security_telemetry_insert_policies.sql
--
-- Replace `WITH CHECK (true)` insert policies on three telemetry tables
-- with policies that constrain user_id to either NULL or the caller's
-- auth.uid(). Without this, an authenticated user could write rows
-- attributing them to any other user_id — not exploitable for access,
-- but pollutes telemetry and breaks per-user investigation.
--
-- user_id semantics for these tables match the `scans`/`client_errors`
-- convention: an unconstrained uuid that callers populate from
-- supabase.auth.getUser(). Anonymous inserts are still allowed where
-- they exist today (client error reports) but must leave user_id NULL.

-- ── alignment_signal_telemetry: authenticated only, own user_id only ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'alignment_signal_telemetry'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS alignment_telemetry_insert ON public.alignment_signal_telemetry';
    EXECUTE 'DROP POLICY IF EXISTS "anyone can insert alignment telemetry" ON public.alignment_signal_telemetry';
    EXECUTE $POL$
      CREATE POLICY alignment_telemetry_insert ON public.alignment_signal_telemetry
        FOR INSERT TO authenticated
        WITH CHECK (user_id IS NULL OR user_id = auth.uid())
    $POL$;
  END IF;
END $$;

-- ── client_errors: keep anon inserts allowed (unauth crash reports)
--   but pin user_id to NULL for anon and to auth.uid() for authenticated.
DROP POLICY IF EXISTS "anyone can insert client errors" ON public.client_errors;

DROP POLICY IF EXISTS client_errors_insert_anon ON public.client_errors;
CREATE POLICY client_errors_insert_anon ON public.client_errors
  FOR INSERT TO anon
  WITH CHECK (user_id IS NULL);

DROP POLICY IF EXISTS client_errors_insert_authenticated ON public.client_errors;
CREATE POLICY client_errors_insert_authenticated ON public.client_errors
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- ── scan_pipeline_checkpoint: authenticated only.
--   Current writer (src/lib/services/scan-checkpoint.ts) leaves user_id
--   NULL on every insert; this still passes the new check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scan_pipeline_checkpoint'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS scan_checkpoint_write_authenticated ON public.scan_pipeline_checkpoint';
    EXECUTE 'DROP POLICY IF EXISTS "authenticated can insert scan_pipeline_checkpoint" ON public.scan_pipeline_checkpoint';
    EXECUTE $POL$
      CREATE POLICY scan_checkpoint_write_authenticated ON public.scan_pipeline_checkpoint
        FOR INSERT TO authenticated
        WITH CHECK (user_id IS NULL OR user_id = auth.uid())
    $POL$;
  END IF;
END $$;
