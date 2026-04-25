-- 016_app_events_purge.sql
--
-- Diagnostic logging — retention purge.
--
-- Tier-based deletion. Storage forecast at 100 active users / 50 scans per
-- user per day puts steady-state retention around ~420MB/yr — comfortable on
-- Supabase Pro. If storage pressure ever shows in the AdminTriageTab Storage
-- panel, tighten the debug interval first (3d → 1d), then sample debug-success
-- events down at the diagnostics.ts call site.
--
-- Triggered manually for now (Supabase MCP execute_sql, or the admin Triage
-- "Run Purge" button). pg_cron is not enabled on this project; if it ever is,
-- schedule this function nightly.

CREATE OR REPLACE FUNCTION public.purge_old_app_events()
	RETURNS TABLE(level TEXT, deleted_count BIGINT)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
DECLARE
	debug_count BIGINT;
	info_count BIGINT;
	warn_count BIGINT;
BEGIN
	-- debug: 7 days
	WITH d AS (
		DELETE FROM public.app_events
		WHERE level = 'debug' AND created_at < NOW() - INTERVAL '7 days'
		RETURNING 1
	)
	SELECT COUNT(*) INTO debug_count FROM d;

	-- info: 7 days
	WITH d AS (
		DELETE FROM public.app_events
		WHERE level = 'info' AND created_at < NOW() - INTERVAL '7 days'
		RETURNING 1
	)
	SELECT COUNT(*) INTO info_count FROM d;

	-- warn: 90 days
	WITH d AS (
		DELETE FROM public.app_events
		WHERE level = 'warn' AND created_at < NOW() - INTERVAL '90 days'
		RETURNING 1
	)
	SELECT COUNT(*) INTO warn_count FROM d;

	-- error/fatal: kept forever (until storage pressure forces a cold archive)

	RETURN QUERY VALUES
		('debug', debug_count),
		('info',  info_count),
		('warn',  warn_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.purge_old_app_events() TO service_role;

-- Storage size helper used by the AdminTriageTab Storage panel.
-- Returns one row with the current size of all three diagnostic tables.
CREATE OR REPLACE FUNCTION public.app_events_storage_summary()
	RETURNS TABLE(
		total_events BIGINT,
		debug_count BIGINT,
		info_count BIGINT,
		warn_count BIGINT,
		error_count BIGINT,
		app_events_bytes BIGINT,
		fingerprint_count BIGINT,
		fingerprints_bytes BIGINT,
		triage_history_count BIGINT,
		triage_history_bytes BIGINT,
		total_diagnostic_bytes BIGINT,
		total_db_bytes BIGINT,
		avg_events_per_day_last_7d NUMERIC
	)
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = public
AS $$
BEGIN
	RETURN QUERY
	SELECT
		(SELECT COUNT(*) FROM public.app_events),
		(SELECT COUNT(*) FROM public.app_events WHERE level = 'debug'),
		(SELECT COUNT(*) FROM public.app_events WHERE level = 'info'),
		(SELECT COUNT(*) FROM public.app_events WHERE level = 'warn'),
		(SELECT COUNT(*) FROM public.app_events WHERE level IN ('error','fatal')),
		pg_total_relation_size('public.app_events'),
		(SELECT COUNT(*) FROM public.event_fingerprints),
		pg_total_relation_size('public.event_fingerprints'),
		(SELECT COUNT(*) FROM public.event_triage_history),
		pg_total_relation_size('public.event_triage_history'),
		pg_total_relation_size('public.app_events')
			+ pg_total_relation_size('public.event_fingerprints')
			+ pg_total_relation_size('public.event_triage_history'),
		pg_database_size(current_database()),
		(SELECT COUNT(*)::NUMERIC / 7
			FROM public.app_events
			WHERE created_at > NOW() - INTERVAL '7 days');
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_events_storage_summary() TO service_role;
