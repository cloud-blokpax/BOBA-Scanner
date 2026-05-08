-- Migration 061 — Archive watermark
--
-- Tracks the last successfully-archived date per (app_id, source_table)
-- pair. Used by /api/cron/archive-to-r2 to know what range to export
-- next, and by Phase 2's pruning RPCs to know what's safe to delete from
-- Postgres.
--
-- TheVault piggybacks by inserting its own rows with app_id='thevault'.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.archive_watermark (
	app_id        text        NOT NULL,
	source_table  text        NOT NULL,
	-- Last calendar-day (UTC) for which all rows have been successfully
	-- written to R2. NULL = nothing archived yet.
	last_archived_date date,
	-- Bookkeeping: last successful run, for diagnostics
	last_run_at        timestamptz,
	last_run_rows      integer,
	last_run_bytes     bigint,
	last_run_object_key text,
	-- Last failed run (if any)
	last_error_at      timestamptz,
	last_error         text,
	updated_at         timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (app_id, source_table)
);

COMMENT ON TABLE public.archive_watermark IS
	'Per-(app_id, source_table) cursor for daily R2 archives. Pruning is gated on last_archived_date — never delete rows newer than this watermark.';

-- Seed rows for card-scanner. Watermarks start NULL — first run will
-- export everything from oldest to (today - 1 day).
INSERT INTO public.archive_watermark (app_id, source_table)
VALUES
	('card-scanner', 'ebay_listing_observations'),
	('card-scanner', 'price_harvest_log')
ON CONFLICT (app_id, source_table) DO NOTHING;

-- RLS: admin-only. The archive cron uses the service-role admin client.
ALTER TABLE public.archive_watermark ENABLE ROW LEVEL SECURITY;

-- No policies = no access for anon/authenticated. Service role bypasses RLS.
-- (Future TheVault use will not need cross-project policies — each app's
-- archive cron uses its own project's service role key.)

-- updated_at trigger — keep last-touched timestamp current
CREATE OR REPLACE FUNCTION public.tg_archive_watermark_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS archive_watermark_updated_at ON public.archive_watermark;
CREATE TRIGGER archive_watermark_updated_at
	BEFORE UPDATE ON public.archive_watermark
	FOR EACH ROW
	EXECUTE FUNCTION public.tg_archive_watermark_updated_at();
