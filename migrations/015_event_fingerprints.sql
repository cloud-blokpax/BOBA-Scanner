-- Migration 15 — Event fingerprints (triage layer)
--
-- One row per unique error pattern. Triage state lives here, not on
-- individual events. Append-only history table records every status change.
-- Trigger on app_events INSERT auto-creates/updates fingerprint rows and
-- detects regressions when fixed bugs resurface.
--
-- Idempotent.

BEGIN;

-- ──────────────────────────────────────────────────────────
-- event_fingerprints: triage state
-- ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_fingerprints (
  fingerprint_hash text PRIMARY KEY,

  event_name text NOT NULL,
  error_code text,
  level      text NOT NULL,

  -- Triage state. CHECK so typos can't introduce a new value.
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN (
      'new','investigating','fix_pending','fixed',
      'understood','ignore','duplicate','regression'
    )),

  summary text,                    -- free-form, evolves as we learn

  occurrence_count integer NOT NULL DEFAULT 0,
  first_seen       timestamptz NOT NULL DEFAULT NOW(),
  last_seen        timestamptz NOT NULL DEFAULT NOW(),

  -- For 'fixed' status: which release contained the fix.
  -- Used by regression detection in the trigger below.
  fixed_in_release_git_sha text,
  fixed_at                 timestamptz,

  -- For 'duplicate' status: canonical fingerprint.
  duplicate_of_hash text REFERENCES public.event_fingerprints(fingerprint_hash),

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_fingerprints_status_idx
  ON public.event_fingerprints(status);

CREATE INDEX IF NOT EXISTS event_fingerprints_last_seen_idx
  ON public.event_fingerprints(last_seen DESC);

CREATE INDEX IF NOT EXISTS event_fingerprints_active_queue_idx
  ON public.event_fingerprints(status, last_seen DESC)
  WHERE status IN ('new','regression','investigating','fix_pending');

-- ──────────────────────────────────────────────────────────
-- event_triage_history: append-only audit trail
-- ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_triage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  fingerprint_hash text NOT NULL
    REFERENCES public.event_fingerprints(fingerprint_hash) ON DELETE CASCADE,

  prev_status text,
  new_status  text NOT NULL,

  note text,

  -- 'jimmy' = manual via admin UI (you)
  -- 'claude' = MCP write-back (me)
  -- 'auto'   = trigger or webhook auto-action
  author text NOT NULL CHECK (author IN ('jimmy','claude','auto')),

  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_triage_history_fingerprint_idx
  ON public.event_triage_history(fingerprint_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS event_triage_history_recent_idx
  ON public.event_triage_history(created_at DESC);

-- Append-only enforcement: no UPDATE or DELETE on history rows.
-- (Restricted via RLS rather than triggers so service-role can still
-- correct mistakes via direct SQL if absolutely needed — but normal
-- code paths cannot.)

ALTER TABLE public.event_triage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_triage_history_no_update ON public.event_triage_history;
CREATE POLICY event_triage_history_no_update ON public.event_triage_history
  FOR UPDATE TO authenticated USING (false);

DROP POLICY IF EXISTS event_triage_history_no_delete ON public.event_triage_history;
CREATE POLICY event_triage_history_no_delete ON public.event_triage_history
  FOR DELETE TO authenticated USING (false);

ALTER TABLE public.event_fingerprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_fingerprints_select_admin ON public.event_fingerprints;
CREATE POLICY event_fingerprints_select_admin ON public.event_fingerprints
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE auth_user_id = auth.uid() AND is_admin = true
    )
  );

-- ──────────────────────────────────────────────────────────
-- Trigger: auto-fingerprint app_events INSERTs
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.app_events_compute_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  fp_hash       text;
  prev_state    record;
  flipped       boolean := false;
BEGIN
  -- Only fingerprint warn/error/fatal events. debug/info would create
  -- thousands of useless fingerprints.
  IF NEW.level NOT IN ('warn','error','fatal') THEN
    RETURN NEW;
  END IF;

  fp_hash := md5(NEW.event_name || ':' || COALESCE(NEW.error_code, ''));
  NEW.fingerprint_hash := fp_hash;

  -- Capture prior state BEFORE the upsert so we can detect if the upsert
  -- caused a fixed → regression flip.
  SELECT status, fixed_at, fixed_in_release_git_sha
    INTO prev_state
    FROM public.event_fingerprints
    WHERE fingerprint_hash = fp_hash;

  -- Upsert. ON CONFLICT auto-flips status='fixed' → 'regression' when an
  -- event arrives from a deploy other than the fix-deploy, after fixed_at.
  INSERT INTO public.event_fingerprints (
    fingerprint_hash, event_name, error_code, level,
    occurrence_count, first_seen, last_seen
  )
  VALUES (
    fp_hash, NEW.event_name, NEW.error_code, NEW.level,
    1, NEW.created_at, NEW.created_at
  )
  ON CONFLICT (fingerprint_hash) DO UPDATE SET
    occurrence_count = event_fingerprints.occurrence_count + 1,
    last_seen = NEW.created_at,
    status = CASE
      WHEN event_fingerprints.status = 'fixed'
        AND event_fingerprints.fixed_at IS NOT NULL
        AND NEW.created_at > event_fingerprints.fixed_at
        AND (
          event_fingerprints.fixed_in_release_git_sha IS NULL
          OR NEW.release_git_sha IS NULL
          OR NEW.release_git_sha <> event_fingerprints.fixed_in_release_git_sha
        )
        THEN 'regression'
      ELSE event_fingerprints.status
    END,
    updated_at = NOW();

  -- Detect whether the upsert actually caused a fixed → regression flip,
  -- and if so, append an audit row.
  IF prev_state.status = 'fixed' THEN
    SELECT (status = 'regression') INTO flipped
      FROM public.event_fingerprints
      WHERE fingerprint_hash = fp_hash;

    IF flipped THEN
      INSERT INTO public.event_triage_history (
        fingerprint_hash, prev_status, new_status, note, author
      )
      VALUES (
        fp_hash, 'fixed', 'regression',
        format(
          'Auto-flagged: event from deploy %s occurred after fix at %s (deploy %s)',
          COALESCE(NEW.release_git_sha, '(unknown)'),
          prev_state.fixed_at,
          COALESCE(prev_state.fixed_in_release_git_sha, '(unknown)')
        ),
        'auto'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_events_fingerprint_trigger ON public.app_events;
CREATE TRIGGER app_events_fingerprint_trigger
  BEFORE INSERT ON public.app_events
  FOR EACH ROW EXECUTE FUNCTION public.app_events_compute_fingerprint();

COMMIT;
