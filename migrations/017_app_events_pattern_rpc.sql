-- 017_app_events_pattern_rpc.sql
--
-- Diagnostic logging — known-pattern firing rates for the AdminTriageTab
-- "Patterns" sub-tab.
--
-- Returns fingerprints that have been triaged to status='understood' or
-- status='ignore', along with how often they've fired in the last 7 days.
-- Lets you sanity-check that "expected" patterns are firing at the expected
-- rate. If a known-rate drops to zero unexpectedly, that's a signal worth
-- investigating ("did we accidentally disable the harvester?").

CREATE OR REPLACE FUNCTION public.event_known_patterns()
	RETURNS TABLE(
		fingerprint_hash TEXT,
		event_name TEXT,
		summary TEXT,
		status TEXT,
		occurrence_count BIGINT,
		last_seen TIMESTAMPTZ,
		occurrences_last_7d BIGINT
	)
	LANGUAGE sql
	SECURITY DEFINER
	SET search_path = public
AS $$
	SELECT
		f.fingerprint_hash,
		f.event_name,
		f.summary,
		f.status,
		f.occurrence_count,
		f.last_seen,
		COALESCE((
			SELECT COUNT(*)::BIGINT
			FROM public.app_events e
			WHERE e.fingerprint_hash = f.fingerprint_hash
				AND e.created_at > NOW() - INTERVAL '7 days'
		), 0) AS occurrences_last_7d
	FROM public.event_fingerprints f
	WHERE f.status IN ('understood','ignore')
	ORDER BY 7 DESC, f.last_seen DESC;
$$;

GRANT EXECUTE ON FUNCTION public.event_known_patterns() TO service_role;
