-- Migration 27 — Listing observation maintenance functions
--
-- Two SQL functions called from the daily /api/cron/mark-stale-listings
-- endpoint. They run as a pair so the QStash schedule has one HTTP call to
-- make rather than two.

-- Mark listings inactive when they haven't been re-observed for 7 days.
-- Approximates eBay's relist cycle — anything older has either sold, ended,
-- or been pulled. The threshold is tunable; see the helper definition.
CREATE OR REPLACE FUNCTION public.mark_stale_ebay_listings()
RETURNS void
LANGUAGE sql
AS $$
	UPDATE public.ebay_card_images
	SET is_active = false
	WHERE is_active = true
	  AND last_seen_at < now() - interval '7 days';
$$;

-- Prune the high-volume per-cycle observations table to a 30-day window.
-- ~60K rows/day × 30d ≈ 1.2 GB at steady state including indexes — within
-- typical Supabase Pro budgets. Tighten to 14d if storage projection blows
-- past 1.5 GB at the 30-day mark.
CREATE OR REPLACE FUNCTION public.prune_old_observations()
RETURNS void
LANGUAGE sql
AS $$
	DELETE FROM public.ebay_listing_observations
	WHERE observed_at < now() - interval '30 days';
$$;
