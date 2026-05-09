-- Migration 063 — Drop Filter Health artifacts
--
-- Filter Health was an admin diagnostic tab for surfacing eBay harvest
-- filter accept rates per card. UI was removed in the comparable-listings
-- branch. Backend (mv_filter_health, three RPCs, /api/admin/filter-health)
-- was kept as "dormant infrastructure" — that's drift, not value.
--
-- If diagnostics are ever needed again, rebuilding from migration 055 +
-- the daily-maintenance cron edit takes ~30 minutes.
--
-- Idempotent. Safe to re-run.

-- Drop the read RPCs first
DROP FUNCTION IF EXISTS public.get_filter_health(int, numeric, text, text, int, int);
DROP FUNCTION IF EXISTS public.get_filter_health_samples(uuid, int, int);
DROP FUNCTION IF EXISTS public.refresh_filter_health();

-- Then the materialized view
DROP MATERIALIZED VIEW IF EXISTS public.mv_filter_health CASCADE;
