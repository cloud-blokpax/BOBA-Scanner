-- Migration 16 — Deployments table + diagnostic RPCs + purge function
--
-- Three things in one migration because they're tightly coupled:
--   1. app_deployments table — Vercel webhook writes here
--   2. triage_fingerprint() RPC — both UI and webhook call this
--   3. diagnostic_bundle_*() RPCs — Claude (via MCP) and admin UI use these
--   4. purge_old_app_events() — scheduled cleanup
--
-- Idempotent.

BEGIN;

-- ──────────────────────────────────────────────────────────
-- app_deployments: every production deploy writes a row
-- ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_deployments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_git_sha   text NOT NULL,
  deploy_url        text,
  deploy_target     text NOT NULL
                      CHECK (deploy_target IN ('production','preview','development')),
  commit_message    text,
  commit_author     text,
  vercel_deploy_id  text UNIQUE,    -- prevents duplicate inserts on webhook
                                    -- retry
  fingerprints_fixed text[] DEFAULT '{}',
  deployed_at       timestamptz NOT NULL DEFAULT NOW(),
  created_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_deployments_sha_idx
  ON public.app_deployments(release_git_sha);

CREATE INDEX IF NOT EXISTS app_deployments_deployed_at_idx
  ON public.app_deployments(deployed_at DESC);

ALTER TABLE public.app_deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_deployments_select_admin ON public.app_deployments;
CREATE POLICY app_deployments_select_admin ON public.app_deployments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_user_id = auth.uid() AND is_admin = true
    )
  );

-- ──────────────────────────────────────────────────────────
-- triage_fingerprint(): the write-back RPC
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.triage_fingerprint(
  p_hash             text,
  p_new_status       text,
  p_note             text DEFAULT NULL,
  p_author           text DEFAULT 'claude',
  p_release_git_sha  text DEFAULT NULL,
  p_summary          text DEFAULT NULL,
  p_duplicate_of_hash text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_status text;
  v_result jsonb;
BEGIN
  IF p_new_status NOT IN (
    'new','investigating','fix_pending','fixed',
    'understood','ignore','duplicate','regression'
  ) THEN
    RAISE EXCEPTION 'invalid status: %', p_new_status;
  END IF;

  IF p_author NOT IN ('jimmy','claude','auto') THEN
    RAISE EXCEPTION 'invalid author: %', p_author;
  END IF;

  SELECT status INTO v_prev_status
    FROM public.event_fingerprints
    WHERE fingerprint_hash = p_hash;

  IF v_prev_status IS NULL THEN
    RAISE EXCEPTION 'fingerprint not found: %', p_hash;
  END IF;

  UPDATE public.event_fingerprints
  SET
    status = p_new_status,
    summary = COALESCE(p_summary, summary),
    fixed_in_release_git_sha = CASE
      WHEN p_new_status = 'fixed'
        THEN COALESCE(p_release_git_sha, fixed_in_release_git_sha)
      WHEN p_new_status NOT IN ('fixed','regression')
        THEN NULL
      ELSE fixed_in_release_git_sha
    END,
    fixed_at = CASE
      WHEN p_new_status = 'fixed' AND fixed_at IS NULL THEN NOW()
      WHEN p_new_status NOT IN ('fixed','regression') THEN NULL
      ELSE fixed_at
    END,
    duplicate_of_hash = CASE
      WHEN p_new_status = 'duplicate' THEN p_duplicate_of_hash
      ELSE NULL
    END,
    updated_at = NOW()
  WHERE fingerprint_hash = p_hash;

  INSERT INTO public.event_triage_history (
    fingerprint_hash, prev_status, new_status, note, author
  )
  VALUES (p_hash, v_prev_status, p_new_status, p_note, p_author);

  SELECT row_to_json(f)::jsonb INTO v_result
    FROM public.event_fingerprints f
    WHERE f.fingerprint_hash = p_hash;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.triage_fingerprint(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.triage_fingerprint(text, text, text, text, text, text, text) TO service_role;

-- ──────────────────────────────────────────────────────────
-- diagnostic_bundle_by_code(): the share-to-Claude RPC
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.diagnostic_bundle_by_code(p_short_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event       record;
  v_fingerprint record;
  v_history     jsonb;
  v_related     jsonb;
  v_recent_same jsonb;
  v_scan        jsonb;
BEGIN
  SELECT * INTO v_event
    FROM public.app_events
    WHERE short_code = p_short_code;

  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('error', format('short_code not found: %s', p_short_code));
  END IF;

  SELECT * INTO v_fingerprint
    FROM public.event_fingerprints
    WHERE fingerprint_hash = v_event.fingerprint_hash;

  -- Recent triage history for this fingerprint
  SELECT COALESCE(jsonb_agg(row_to_json(h) ORDER BY h.created_at DESC), '[]'::jsonb)
    INTO v_history
    FROM public.event_triage_history h
    WHERE h.fingerprint_hash = v_event.fingerprint_hash
    LIMIT 20;

  -- Related events from the same request_id (multi-event flow)
  IF v_event.request_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(row_to_json(e) ORDER BY e.created_at), '[]'::jsonb)
      INTO v_related
      FROM public.app_events e
      WHERE e.request_id = v_event.request_id
        AND e.id <> v_event.id;
  ELSE
    v_related := '[]'::jsonb;
  END IF;

  -- Recent occurrences of the same fingerprint (last 24h, max 10)
  SELECT COALESCE(jsonb_agg(row_to_json(e) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_recent_same
    FROM (
      SELECT id, short_code, created_at, user_id, error_message, context
      FROM public.app_events
      WHERE fingerprint_hash = v_event.fingerprint_hash
        AND created_at > NOW() - INTERVAL '24 hours'
        AND id <> v_event.id
      ORDER BY created_at DESC
      LIMIT 10
    ) e;

  -- Linked scan, if any
  IF v_event.scan_id IS NOT NULL THEN
    SELECT row_to_json(s)::jsonb INTO v_scan
      FROM public.scans s
      WHERE s.id = v_event.scan_id;
  ELSE
    v_scan := NULL;
  END IF;

  RETURN jsonb_build_object(
    'event',         row_to_json(v_event),
    'fingerprint',   row_to_json(v_fingerprint),
    'triage_history', v_history,
    'related_events', v_related,
    'recent_same_fingerprint', v_recent_same,
    'linked_scan',   v_scan
  );
END;
$$;

REVOKE ALL ON FUNCTION public.diagnostic_bundle_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diagnostic_bundle_by_code(text) TO service_role;

-- ──────────────────────────────────────────────────────────
-- diagnostic_bundle_by_scan(): everything for one scan
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.diagnostic_bundle_by_scan(p_scan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scan        jsonb;
  v_events      jsonb;
  v_tier_results jsonb;
  v_checkpoints jsonb;
BEGIN
  SELECT row_to_json(s)::jsonb INTO v_scan
    FROM public.scans s WHERE s.id = p_scan_id;

  IF v_scan IS NULL THEN
    RETURN jsonb_build_object('error', format('scan not found: %s', p_scan_id));
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(e) ORDER BY e.created_at), '[]'::jsonb)
    INTO v_events
    FROM public.app_events e
    WHERE e.scan_id = p_scan_id;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.ran_at), '[]'::jsonb)
    INTO v_tier_results
    FROM public.scan_tier_results t
    WHERE t.scan_id = p_scan_id;

  SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.elapsed_ms), '[]'::jsonb)
    INTO v_checkpoints
    FROM public.scan_pipeline_checkpoint c
    WHERE c.scan_id = p_scan_id;

  RETURN jsonb_build_object(
    'scan',         v_scan,
    'events',       v_events,
    'tier_results', v_tier_results,
    'checkpoints',  v_checkpoints
  );
END;
$$;

REVOKE ALL ON FUNCTION public.diagnostic_bundle_by_scan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.diagnostic_bundle_by_scan(uuid) TO service_role;

-- ──────────────────────────────────────────────────────────
-- purge_old_app_events(): scheduled cleanup
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_old_app_events()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_debug_deleted int;
  v_info_deleted  int;
  v_warn_deleted  int;
BEGIN
  -- debug events: 7-day retention
  WITH d AS (
    DELETE FROM public.app_events
      WHERE level = 'debug'
        AND created_at < NOW() - INTERVAL '7 days'
      RETURNING 1
  ) SELECT COUNT(*) INTO v_debug_deleted FROM d;

  -- info events: 7-day retention
  WITH d AS (
    DELETE FROM public.app_events
      WHERE level = 'info'
        AND created_at < NOW() - INTERVAL '7 days'
      RETURNING 1
  ) SELECT COUNT(*) INTO v_info_deleted FROM d;

  -- warn events: 90-day retention
  WITH d AS (
    DELETE FROM public.app_events
      WHERE level = 'warn'
        AND created_at < NOW() - INTERVAL '90 days'
      RETURNING 1
  ) SELECT COUNT(*) INTO v_warn_deleted FROM d;

  -- error/fatal events: never deleted (kept for trend analysis)

  -- Auto-promote stale 'investigating' fingerprints to 'understood'
  -- (no new occurrences in 14 days)
  WITH stale AS (
    UPDATE public.event_fingerprints
    SET status = 'understood', updated_at = NOW()
    WHERE status = 'investigating'
      AND last_seen < NOW() - INTERVAL '14 days'
    RETURNING fingerprint_hash
  )
  INSERT INTO public.event_triage_history (
    fingerprint_hash, prev_status, new_status, note, author
  )
  SELECT
    fingerprint_hash, 'investigating', 'understood',
    'Auto-promoted: no new occurrences in 14 days',
    'auto'
  FROM stale;

  RETURN jsonb_build_object(
    'debug_deleted', v_debug_deleted,
    'info_deleted',  v_info_deleted,
    'warn_deleted',  v_warn_deleted,
    'purged_at',     NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_app_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_app_events() TO service_role;

COMMIT;
