-- Migration 075 — Weekly storage health check
--
-- Schema for the weekly storage health monitor (Edge Function
-- `weekly-storage-check`, triggered by QStash every Monday).
--
-- Adds:
--   1. `get_database_size()` — single-row RPC returning total DB MB.
--   2. `get_archival_table_sizes()` — per-table size for the three big
--      archival tables (ebay_listing_observations, price_harvest_log,
--      external_pricing_history). Ordered by size desc so the caller can
--      take row[0] as the largest.
--   3. `get_storage_bucket_sizes()` — per-bucket MB summed from
--      storage.objects metadata. Covers all known buckets, not a
--      hardcoded subset.
--   4. `storage_health_log` — weekly snapshot table, service-role-only.
--
-- Thresholds (8GB total DB ceiling, 500MB archival, 100MB buckets) live
-- in the Edge Function, not in SQL, so adjusting them doesn't require a
-- migration.
--
-- Idempotent — safe to re-run.

-- ── 1. get_database_size() ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_database_size()
RETURNS TABLE (size_mb numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
	SELECT ROUND(pg_database_size(current_database()) / 1024.0 / 1024.0, 2)::numeric AS size_mb;
$$;

REVOKE EXECUTE ON FUNCTION public.get_database_size() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_database_size() TO service_role;

-- ── 2. get_archival_table_sizes() ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_archival_table_sizes()
RETURNS TABLE (
	name text,
	size_mb numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
	SELECT
		tablename::text AS name,
		ROUND(pg_total_relation_size(format('%I.%I', schemaname, tablename)) / 1024.0 / 1024.0, 2)::numeric AS size_mb
	FROM pg_tables
	WHERE schemaname = 'public'
	  AND tablename IN (
		'ebay_listing_observations',
		'price_harvest_log',
		'external_pricing_history'
	)
	ORDER BY pg_total_relation_size(format('%I.%I', schemaname, tablename)) DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_archival_table_sizes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_archival_table_sizes() TO service_role;

-- ── 3. get_storage_bucket_sizes() ──────────────────────────────────
-- Sums object sizes across all buckets. Returning every bucket (not a
-- hardcoded subset) so new buckets show up automatically.
CREATE OR REPLACE FUNCTION public.get_storage_bucket_sizes()
RETURNS TABLE (
	bucket text,
	size_mb numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = storage, public, pg_catalog
AS $$
	SELECT
		bucket_id::text AS bucket,
		ROUND(SUM(COALESCE((metadata->>'size')::bigint, 0)) / 1024.0 / 1024.0, 2)::numeric AS size_mb
	FROM storage.objects
	GROUP BY bucket_id
	ORDER BY SUM(COALESCE((metadata->>'size')::bigint, 0)) DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_storage_bucket_sizes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_storage_bucket_sizes() TO service_role;

-- ── 4. storage_health_log table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.storage_health_log (
	id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	checked_at         timestamptz NOT NULL DEFAULT now(),
	total_db_mb        numeric NOT NULL,
	archival_tables_mb numeric NOT NULL,
	storage_buckets_mb numeric NOT NULL,
	largest_table_name text NOT NULL,
	largest_table_mb   numeric NOT NULL,
	alerts             text[]
);

CREATE INDEX IF NOT EXISTS idx_storage_health_log_checked_at
	ON public.storage_health_log (checked_at DESC);

-- service-role-only: no grants to anon/authenticated.
GRANT SELECT, INSERT ON public.storage_health_log TO service_role;

ALTER TABLE public.storage_health_log ENABLE ROW LEVEL SECURITY;
-- No policies = locked down except service_role (which bypasses RLS).
