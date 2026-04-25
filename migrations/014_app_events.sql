-- 014_app_events.sql
--
-- Diagnostic logging — primary event stream.
--
-- Every diagnostic event (server wrap() failure, client unhandled error,
-- handleError-caught request error, scan-writer logFailure, etc.) lands here.
-- One row per occurrence; fingerprint groups identical occurrences for triage
-- (see migration 015).
--
-- Retention is tier-based — debug/info purged after 7 days, warn after 90 days,
-- error/fatal kept forever (see migration 017's purge function).

CREATE TABLE IF NOT EXISTS public.app_events (
	id BIGSERIAL PRIMARY KEY,

	-- Severity tier. Drives retention and triage queueing.
	-- debug:  successful wrap() calls under sample rate; not fingerprinted
	-- info:   expected outcomes (no eligible cards, rate limited 429, etc.); not fingerprinted
	-- warn:   non-fatal failures (badge award failed, dynamic import failed)
	-- error:  genuine errors that broke a code path
	-- fatal:  process-level failures (unhandled rejection, OOM, timeout)
	level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error','fatal')),

	-- Dotted event name. Examples:
	--   ebay.policies.fetch_seller
	--   harvest.boba.card_threw_unexpectedly
	--   scan.writer.open_session_failed
	--   client.unhandled_rejection
	--   vercel.runtime.error
	event_name TEXT NOT NULL,

	-- Where the event came from. 'edge' is reserved for the Vercel log mirror.
	source TEXT NOT NULL CHECK (source IN ('server','client','edge','worker')),

	-- Stable identifier for grouping identical occurrences. NULL for debug/info
	-- (those don't get triaged). Computed by diagnostics.ts before insert.
	fingerprint_hash TEXT,

	-- Human-readable summary (first ~120 chars of the error message). Helps
	-- you skim the active queue without expanding rows.
	summary TEXT,

	-- Optional short error code (e.g. an HTTP status, a Postgres error code,
	-- or a custom 'EXIF_FAIL' tag). Surfaced to users in toasts.
	error_code TEXT,

	-- Full error payload — message, stack trace, response body, etc.
	-- Not indexed; pulled when expanding a row in the triage UI.
	error_detail JSONB,

	-- Free-form context (user_id, scan_id, request_path, vercel_request_id, etc.).
	-- Should NOT contain PII beyond IDs you'd already store elsewhere.
	context JSONB DEFAULT '{}'::jsonb NOT NULL,

	-- Soft references — not foreign keys, because the referenced row may have
	-- been purged or the user may be anonymous.
	user_id UUID,
	scan_id UUID,
	request_path TEXT,
	vercel_request_id TEXT,

	-- Versioning. Bump when the event_detail/context shape changes meaningfully.
	schema_version SMALLINT DEFAULT 1 NOT NULL,

	created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes — kept narrow on purpose. The triage UI hits these:
--   1. List recent events at a given level
--   2. Look up all occurrences for a fingerprint
--   3. Filter by event_name when investigating a specific code path
CREATE INDEX IF NOT EXISTS app_events_created_at_idx
	ON public.app_events (created_at DESC);

CREATE INDEX IF NOT EXISTS app_events_level_created_idx
	ON public.app_events (level, created_at DESC);

CREATE INDEX IF NOT EXISTS app_events_fingerprint_idx
	ON public.app_events (fingerprint_hash, created_at DESC)
	WHERE fingerprint_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS app_events_event_name_idx
	ON public.app_events (event_name, created_at DESC);

-- RLS — service role only. The diagnostics service writes via getAdminClient(),
-- and the admin Triage tab reads via /api/admin/triage (which uses requireAdmin
-- + getAdminClient). No user-facing path touches this table directly.
ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

-- No policies = service role only. Authenticated users get nothing.
