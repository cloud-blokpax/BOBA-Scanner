-- Migration 057 — get_card_listings RPC
--
-- Returns the most recent unique accepted eBay listings for a card,
-- powering the "comparable listings" panel in the post-scan price
-- section. Reads from ebay_listing_observations (admin-RLS), so the
-- function is SECURITY DEFINER + search_path=public — only the
-- whitelisted columns ever leave the function boundary.
--
-- Performance: bounded inner LIMIT keeps the worst-case card (heaviest
-- has 26K observations) under 100 ms. Verified May 2026.
--
-- Apply via Supabase MCP, then deploy code.

CREATE OR REPLACE FUNCTION public.get_card_listings(
	p_card_id uuid,
	p_limit int DEFAULT 10
)
RETURNS TABLE(
	ebay_item_id text,
	title text,
	price_value numeric,
	condition_label text,
	image_url text,
	item_affiliate_url text,
	item_web_url text,
	seller_username text,
	seller_feedback_pct numeric,
	observed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	-- Step 1: bounded fetch of recent accepted observations for this card.
	-- The inner LIMIT keeps this fast even when one card has many thousands
	-- of observations (the cross-parallel contamination outliers).
	WITH recent AS (
		SELECT
			ebay_item_id,
			title,
			price_value,
			condition_label,
			image_url,
			item_affiliate_url,
			item_web_url,
			seller_username,
			seller_feedback_pct,
			observed_at
		FROM public.ebay_listing_observations
		WHERE card_id = p_card_id
		  AND accepted_by_filter = true
		ORDER BY observed_at DESC
		LIMIT GREATEST(p_limit, 10) * 10  -- 10x the requested unique count to give the dedupe headroom
	)
	-- Step 2: dedupe to most recent observation per ebay_item_id, return p_limit unique listings.
	SELECT DISTINCT ON (ebay_item_id)
		ebay_item_id,
		title,
		price_value,
		condition_label,
		image_url,
		item_affiliate_url,
		item_web_url,
		seller_username,
		seller_feedback_pct,
		observed_at
	FROM recent
	ORDER BY ebay_item_id, observed_at DESC
	LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_card_listings(uuid, int) IS
	'Most recent unique accepted eBay listings for a card. SECURITY DEFINER because the source table (ebay_listing_observations) is admin-RLS. Returns whitelisted columns only — never raw observations payload. Used by /api/card-listings/[cardId] for the post-scan comparable-listings panel.';

-- Authenticated users can call. The endpoint also uses the admin client,
-- so this grant is belt-and-suspenders.
REVOKE ALL ON FUNCTION public.get_card_listings(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_card_listings(uuid, int) TO authenticated, service_role;
