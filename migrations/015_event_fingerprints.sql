-- 015_event_fingerprints.sql
--
-- Diagnostic logging — fingerprint registry + triage state.
--
-- A fingerprint groups identical-shaped events together so the active queue
-- doesn't drown in duplicates. The first time a fingerprint is seen we INSERT
-- a row here; subsequent occurrences UPDATE occurrence_count + last_seen.
--
-- Status drives the active-vs-archive view in AdminTriageTab:
--   active     — new fingerprint, never reviewed. Surfaces in active queue.
--   investigating — admin marked while debugging.
--   understood — known pattern, root cause identified, choosing not to fix.
--                Bumps occurrence count silently; doesn't surface in active.
--   ignore     — noise, should never have been logged. Same UI behavior as understood.
--   resolved   — fixed in code; future occurrences flip back to active automatically
--                because the fix should mean we never see it again.

CREATE TABLE IF NOT EXISTS public.event_fingerprints (
	fingerprint_hash TEXT PRIMARY KEY,

	-- The event_name from the first occurrence. We don't change it on
	-- subsequent occurrences — fingerprints with the same hash but different
	-- event_names are a bug in fingerprinting that should be investigated.
	event_name TEXT NOT NULL,

	-- First/best summary observed. Updated when occurrences arrive with a
	-- substantively-different summary (rare; we keep the longest).
	summary TEXT,

	-- Optional short code (Postgres SQLSTATE, HTTP status, etc.) carried over
	-- from the first occurrence.
	error_code TEXT,

	-- Triage state.
	status TEXT NOT NULL DEFAULT 'active'
		CHECK (status IN ('active','investigating','understood','ignore','resolved')),

	-- Occurrence stats. Updated on every event insert via diagnostics.ts.
	occurrence_count BIGINT NOT NULL DEFAULT 1,
	first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),

	-- Optional admin note set during triage.
	notes TEXT,

	-- Last admin who changed the status. NULL until the first triage action.
	last_triaged_by UUID,
	last_triaged_at TIMESTAMPTZ,

	created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
	updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS event_fingerprints_status_idx
	ON public.event_fingerprints (status, last_seen DESC);

CREATE INDEX IF NOT EXISTS event_fingerprints_event_name_idx
	ON public.event_fingerprints (event_name);

CREATE INDEX IF NOT EXISTS event_fingerprints_last_seen_idx
	ON public.event_fingerprints (last_seen DESC);

-- updated_at trigger (uses the existing generic update_updated_at_column function).
CREATE TRIGGER event_fingerprints_set_updated_at
	BEFORE UPDATE ON public.event_fingerprints
	FOR EACH ROW
	EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.event_fingerprints ENABLE ROW LEVEL SECURITY;
-- Service role only.

-- ── Triage history — audit trail of admin actions on fingerprints ──
CREATE TABLE IF NOT EXISTS public.event_triage_history (
	id BIGSERIAL PRIMARY KEY,

	fingerprint_hash TEXT NOT NULL
		REFERENCES public.event_fingerprints (fingerprint_hash) ON DELETE CASCADE,

	-- Who took the action. Soft-FK; admin user IDs come from auth.users.
	admin_id UUID NOT NULL,

	-- What changed. Encoded as a small enum so the UI can render appropriate
	-- icons; free-text notes go in the notes column.
	action TEXT NOT NULL CHECK (action IN (
		'status_changed','noted','reopened','bulk_archived'
	)),

	old_status TEXT,
	new_status TEXT,

	notes TEXT,

	created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS event_triage_history_fingerprint_idx
	ON public.event_triage_history (fingerprint_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS event_triage_history_admin_idx
	ON public.event_triage_history (admin_id, created_at DESC);

ALTER TABLE public.event_triage_history ENABLE ROW LEVEL SECURITY;
-- Service role only.

-- ── Trigger: auto-maintain event_fingerprints on app_events insert ──
--
-- Whenever a new row lands in app_events with a non-null fingerprint_hash,
-- upsert the registry: insert if new (with occurrence_count=1), bump the
-- counter and last_seen if the fingerprint already exists.
--
-- Keeps diagnostics.ts simple — it only writes one row per event and the
-- trigger handles the denormalized index.

CREATE OR REPLACE FUNCTION public.app_events_maintain_fingerprint()
	RETURNS TRIGGER
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
BEGIN
	IF NEW.fingerprint_hash IS NULL THEN
		RETURN NEW;
	END IF;

	INSERT INTO public.event_fingerprints (
		fingerprint_hash, event_name, summary, error_code,
		occurrence_count, first_seen, last_seen
	) VALUES (
		NEW.fingerprint_hash, NEW.event_name, NEW.summary, NEW.error_code,
		1, NEW.created_at, NEW.created_at
	)
	ON CONFLICT (fingerprint_hash) DO UPDATE
		SET occurrence_count = public.event_fingerprints.occurrence_count + 1,
		    last_seen = EXCLUDED.last_seen,
		    -- Keep the first non-null summary/error_code we ever saw.
		    summary = COALESCE(public.event_fingerprints.summary, EXCLUDED.summary),
		    error_code = COALESCE(public.event_fingerprints.error_code, EXCLUDED.error_code),
		    -- If the fingerprint was previously marked 'resolved', a new occurrence
		    -- means the fix didn't take — flip back to 'active' to surface for retriage.
		    status = CASE
		    	WHEN public.event_fingerprints.status = 'resolved' THEN 'active'
		    	ELSE public.event_fingerprints.status
		    END;

	RETURN NEW;
END;
$$;

CREATE TRIGGER app_events_maintain_fingerprint
	AFTER INSERT ON public.app_events
	FOR EACH ROW
	EXECUTE FUNCTION public.app_events_maintain_fingerprint();

