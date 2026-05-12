
-- Re-declare so future deployments have everything in one place.
-- This is idempotent — both materialized views and functions use OR REPLACE
-- or IF NOT EXISTS where supported.

-- Also patch refresh_canonical_listing_attributions to refresh both views,
-- so daily-maintenance's call cascades cleanly.

CREATE OR REPLACE FUNCTION public.refresh_canonical_listing_attributions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.canonical_listing_attributions;
  -- canonical_price_cache reads from the above, so refresh it AFTER so the
  -- two views are always self-consistent. daily-maintenance only calls this
  -- one function; the chain is internal.
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.canonical_price_cache;
END;
$$;

COMMENT ON FUNCTION public.refresh_canonical_listing_attributions IS
  'Refresh both canonical_listing_attributions and the downstream canonical_price_cache. Called from daily-maintenance cron. Chain ordering matters: listing attributions feed price cache.';
