-- Migration 14 — app_events: unified diagnostic event stream
--
-- Single source-of-truth log table for browser, server, edge, and cron events.
-- High-volume; auto-purge handled by separate scheduled job (see migration 016
-- for the purge function).
--
-- Idempotent. CREATE TABLE IF NOT EXISTS; indexes likewise.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 6-char shareable short code. Generated client/server-side; alphabet
  -- excludes 0/O/1/I/l for visual legibility. UNIQUE so the share-to-Claude
  -- workflow ("diag k7m2qp") resolves to a single event.
  short_code   text NOT NULL UNIQUE,

  level        text NOT NULL
                CHECK (level IN ('debug','info','warn','error','fatal')),

  source       text NOT NULL
                CHECK (source IN ('client','server','edge','cron')),

  -- Stable, dot-separated identifier. Examples:
  --   'recognition.tier1_canonical.success'
  --   'ebay.create_offer.failed'
  --   'harvest.boba.cycle.start'
  --   'scan_writer.update_outcome.failed'
  -- Used as the primary input to fingerprint hashing.
  event_name   text NOT NULL,

  -- Foreign keys. Denormalized for fast filtering. NULL when not applicable.
  user_id      uuid,                 -- not FK'd to auth.users to keep this
                                     -- table writable from anonymous clients
  session_id   uuid,                 -- scan session, http session, etc.
  scan_id      uuid REFERENCES public.scans(id) ON DELETE SET NULL,
  game_id      text,                 -- 'boba' | 'wonders'
  request_id   text,                 -- ties multi-event flows together

  context      jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Error-only fields. NULL for non-error events.
  error_message text,
  error_stack   text,
  error_code    text,                 -- e.g. 'ebay.token_expired',
                                      --      'supabase.RLS_DENIED'

  duration_ms  integer,

  pipeline_version text,
  release_git_sha  text,              -- which deploy generated this event
  app_version  text,

  -- Set BEFORE INSERT by the trigger in migration 015. NULL for debug/info
  -- events that aren't fingerprinted.
  fingerprint_hash text,

  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_events_created_at_idx
  ON public.app_events(created_at DESC);

CREATE INDEX IF NOT EXISTS app_events_user_created_idx
  ON public.app_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS app_events_short_code_idx
  ON public.app_events(short_code);

CREATE INDEX IF NOT EXISTS app_events_scan_id_idx
  ON public.app_events(scan_id)
  WHERE scan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS app_events_level_error_idx
  ON public.app_events(created_at DESC)
  WHERE level IN ('error','fatal');

CREATE INDEX IF NOT EXISTS app_events_event_name_idx
  ON public.app_events(event_name);

CREATE INDEX IF NOT EXISTS app_events_request_id_idx
  ON public.app_events(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS app_events_context_gin_idx
  ON public.app_events USING GIN (context);

-- ── RLS ─────────────────────────────────────────────────
-- Authenticated users can read their own events. Service role writes anything.
-- Admins (via the admin RPCs in 016) read everything.

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_events_select_own ON public.app_events;
CREATE POLICY app_events_select_own ON public.app_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS app_events_no_user_write ON public.app_events;
CREATE POLICY app_events_no_user_write ON public.app_events
  FOR INSERT TO authenticated
  WITH CHECK (false);    -- All writes go via service-role RPC; no direct
                         -- user inserts. Prevents users from logging fake
                         -- events as other users.

COMMIT;
