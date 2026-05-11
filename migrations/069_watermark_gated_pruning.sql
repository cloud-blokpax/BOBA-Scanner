-- Migration 069 — Watermark-gated Postgres pruning
--
-- Replaces the naive `prune_old_observations()` (which used now() - 30d
-- with no archive awareness) with three RPCs that gate deletion on
-- archive_watermark.last_archived_date. We will NEVER delete a row that
-- isn't confirmed to be in R2.
--
-- Three RPCs, one per source table. Each:
--   1. Reads its watermark
--   2. Computes a "safe cutoff" = last_archived_date - safety_buffer_days
--   3. Deletes rows older than safe cutoff
--   4. Returns count of deleted rows + safe_cutoff for logging
--
-- A separate `is_archive_fresh()` predicate is used by daily-maintenance
-- to refuse pruning if archive hasn't advanced in 26 hours — guarantees
-- we never silently prune against a stale watermark.
--
-- Idempotent. Safe to re-run.

-- ── 1. Drop the naive RPC ──────────────────────────────────
DROP FUNCTION IF EXISTS public.prune_old_observations();

-- ── 2. Freshness predicate (used by daily-maintenance) ─────
CREATE OR REPLACE FUNCTION public.is_archive_fresh()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT bool_and(last_run_at > now() - interval '26 hours')
  FROM archive_watermark
  WHERE app_id = 'card-scanner';
$$;

COMMENT ON FUNCTION public.is_archive_fresh() IS
  'True if every card-scanner archive watermark has been updated in the last 26 hours. Daily-maintenance gates pruning on this so a broken archive cron does not lead to silent data loss.';

-- ── 3. Prune observations (7-day safety buffer) ────────────
CREATE OR REPLACE FUNCTION public.prune_archived_observations()
RETURNS TABLE(deleted_rows bigint, safe_cutoff date, watermark_date date)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_wm_date date;
  v_safe_cutoff date;
  v_deleted bigint;
  v_safety_buffer_days int := 7;
BEGIN
  SELECT last_archived_date INTO v_wm_date
  FROM archive_watermark
  WHERE app_id = 'card-scanner' AND source_table = 'ebay_listing_observations';

  IF v_wm_date IS NULL THEN
    RETURN QUERY SELECT 0::bigint, NULL::date, NULL::date;
    RETURN;
  END IF;

  v_safe_cutoff := v_wm_date - v_safety_buffer_days;

  DELETE FROM ebay_listing_observations
  WHERE observed_at < (v_safe_cutoff::timestamptz);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT v_deleted, v_safe_cutoff, v_wm_date;
END;
$$;

COMMENT ON FUNCTION public.prune_archived_observations() IS
  'Deletes ebay_listing_observations rows older than (last_archived_date - 7 days). Returns deletion count for logging. Safe: if watermark is NULL or stale, function returns 0 (no-op).';

-- ── 4. Prune harvest log (7-day safety buffer) ─────────────
CREATE OR REPLACE FUNCTION public.prune_archived_harvest_log()
RETURNS TABLE(deleted_rows bigint, safe_cutoff date, watermark_date date)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_wm_date date;
  v_safe_cutoff date;
  v_deleted bigint;
  v_safety_buffer_days int := 7;
BEGIN
  SELECT last_archived_date INTO v_wm_date
  FROM archive_watermark
  WHERE app_id = 'card-scanner' AND source_table = 'price_harvest_log';

  IF v_wm_date IS NULL THEN
    RETURN QUERY SELECT 0::bigint, NULL::date, NULL::date;
    RETURN;
  END IF;

  v_safe_cutoff := v_wm_date - v_safety_buffer_days;

  DELETE FROM price_harvest_log
  WHERE processed_at < (v_safe_cutoff::timestamptz);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT v_deleted, v_safe_cutoff, v_wm_date;
END;
$$;

COMMENT ON FUNCTION public.prune_archived_harvest_log() IS
  'Deletes price_harvest_log rows older than (last_archived_date - 7 days). Returns deletion count for logging.';

-- ── 5. Prune external pricing history (30-day safety buffer) ─
-- Longer buffer: this is your sales-history strategic asset, kept
-- hot for ad-hoc queries before falling back to R2.
CREATE OR REPLACE FUNCTION public.prune_archived_external_pricing_history()
RETURNS TABLE(deleted_rows bigint, safe_cutoff date, watermark_date date)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_wm_date date;
  v_safe_cutoff date;
  v_deleted bigint;
  v_safety_buffer_days int := 30;
BEGIN
  SELECT last_archived_date INTO v_wm_date
  FROM archive_watermark
  WHERE app_id = 'card-scanner' AND source_table = 'external_pricing_history';

  IF v_wm_date IS NULL THEN
    RETURN QUERY SELECT 0::bigint, NULL::date, NULL::date;
    RETURN;
  END IF;

  v_safe_cutoff := v_wm_date - v_safety_buffer_days;

  DELETE FROM external_pricing_history
  WHERE created_at < (v_safe_cutoff::timestamptz);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN QUERY SELECT v_deleted, v_safe_cutoff, v_wm_date;
END;
$$;

COMMENT ON FUNCTION public.prune_archived_external_pricing_history() IS
  'Deletes external_pricing_history rows older than (last_archived_date - 30 days). Longer buffer than other tables: this is the sales-history strategic dataset.';

-- ── 6. Grants ──────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.is_archive_fresh() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_archived_observations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_archived_harvest_log() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_archived_external_pricing_history() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_archive_fresh() TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_archived_observations() TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_archived_harvest_log() TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_archived_external_pricing_history() TO service_role;
