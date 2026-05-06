-- Migration 055 — Filter health materialized view
--
-- Aggregates per-card eBay harvest filter performance from
-- `ebay_listing_observations`. Powers the admin Filter Health tab.
--
-- Refresh is driven from /api/cron/mark-stale-listings (daily). Live reads
-- against the source table take ~4s on the current 146K rows; the MV cuts
-- that to <100ms with ~1.6K aggregate rows.
--
-- CONCURRENTLY refresh requires a UNIQUE index — provided below.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_filter_health AS
SELECT
	o.card_id,
	c.game_id,
	c.hero_name,
	c.name,
	c.card_number,
	c.parallel,
	c.weapon_type,
	COUNT(*)::int                                                 AS total_obs,
	COUNT(*) FILTER (WHERE o.accepted_by_filter)::int             AS accepted,
	COUNT(*) FILTER (WHERE NOT o.accepted_by_filter)::int         AS rejected,
	COUNT(*) FILTER (WHERE o.rejection_reason = 'identity_gate')::int        AS identity_rejects,
	COUNT(*) FILTER (WHERE o.rejection_reason = 'weapon_conflict')::int      AS weapon_rejects,
	COUNT(*) FILTER (WHERE o.rejection_reason = 'parallel_gate')::int        AS parallel_rejects,
	COUNT(*) FILTER (WHERE o.rejection_reason LIKE 'hard_reject:%')::int     AS hard_rejects,
	COUNT(*) FILTER (WHERE o.rejection_reason = 'set_anchor')::int           AS anchor_rejects,
	COUNT(*) FILTER (WHERE o.rejection_reason = 'wonders_anchor')::int       AS wonders_anchor_rejects,
	COUNT(*) FILTER (WHERE o.rejection_reason = 'boba_contamination')::int   AS boba_contamination_rejects,
	COUNT(*) FILTER (WHERE o.rejection_reason = 'bulk_lot')::int             AS bulk_lot_rejects,
	COUNT(*) FILTER (WHERE o.rejection_reason = 'missing_title')::int        AS missing_title_rejects,
	(MODE() WITHIN GROUP (ORDER BY o.rejection_reason))           AS top_rejection,
	MAX(o.observed_at)                                            AS last_observed,
	MIN(o.observed_at)                                            AS first_observed,
	now()                                                          AS refreshed_at
FROM public.ebay_listing_observations o
JOIN public.cards c ON c.id = o.card_id
GROUP BY o.card_id, c.game_id, c.hero_name, c.name, c.card_number, c.parallel, c.weapon_type;

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS mv_filter_health_card_id_idx
	ON public.mv_filter_health (card_id);

CREATE INDEX IF NOT EXISTS mv_filter_health_accept_idx
	ON public.mv_filter_health (game_id, total_obs DESC, accepted);

-- Refresh wrapper — returns the row count post-refresh so the cron can log it.
CREATE OR REPLACE FUNCTION public.refresh_filter_health()
RETURNS TABLE(refreshed_rows int, ran_at timestamptz)
LANGUAGE plpgsql
AS $$
BEGIN
	REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_filter_health;
	RETURN QUERY
	SELECT COUNT(*)::int, now()
	FROM public.mv_filter_health;
END;
$$;

-- Read RPC — paginated, sortable. Filters by min observations and game.
-- Sort options: 'accept_pct_asc' (default — worst first), 'total_obs_desc',
-- 'last_observed_desc'.
CREATE OR REPLACE FUNCTION public.get_filter_health(
	p_min_obs int DEFAULT 10,
	p_max_accept_pct numeric DEFAULT 100,
	p_game_id text DEFAULT NULL,
	p_sort text DEFAULT 'accept_pct_asc',
	p_limit int DEFAULT 100,
	p_offset int DEFAULT 0
)
RETURNS TABLE(
	card_id uuid,
	game_id text,
	hero_name text,
	name text,
	card_number text,
	parallel text,
	weapon_type text,
	total_obs int,
	accepted int,
	rejected int,
	accept_pct numeric,
	identity_rejects int,
	weapon_rejects int,
	parallel_rejects int,
	hard_rejects int,
	anchor_rejects int,
	wonders_anchor_rejects int,
	boba_contamination_rejects int,
	bulk_lot_rejects int,
	missing_title_rejects int,
	top_rejection text,
	last_observed timestamptz
)
LANGUAGE sql
STABLE
AS $$
	SELECT
		card_id, game_id, hero_name, name, card_number, parallel, weapon_type,
		total_obs, accepted, rejected,
		ROUND(100.0 * accepted / NULLIF(total_obs, 0), 1) AS accept_pct,
		identity_rejects, weapon_rejects, parallel_rejects, hard_rejects,
		anchor_rejects, wonders_anchor_rejects, boba_contamination_rejects,
		bulk_lot_rejects, missing_title_rejects,
		top_rejection, last_observed
	FROM public.mv_filter_health
	WHERE total_obs >= p_min_obs
	  AND ROUND(100.0 * accepted / NULLIF(total_obs, 0), 1) <= p_max_accept_pct
	  AND (p_game_id IS NULL OR game_id = p_game_id)
	ORDER BY
		CASE WHEN p_sort = 'accept_pct_asc'    THEN (accepted::float / NULLIF(total_obs, 0)) END ASC NULLS LAST,
		CASE WHEN p_sort = 'total_obs_desc'    THEN total_obs END DESC,
		CASE WHEN p_sort = 'last_observed_desc' THEN last_observed END DESC,
		total_obs DESC
	LIMIT p_limit OFFSET p_offset;
$$;

-- Drawer RPC — pull recent rejected/accepted listing samples for one card.
-- Reads live from ebay_listing_observations using the card_id index.
CREATE OR REPLACE FUNCTION public.get_filter_health_samples(
	p_card_id uuid,
	p_rejected_limit int DEFAULT 25,
	p_accepted_limit int DEFAULT 10
)
RETURNS TABLE(
	bucket text,
	observed_at timestamptz,
	ebay_item_id text,
	title text,
	price_value numeric,
	condition_label text,
	rejection_reason text,
	weapon_conflict boolean,
	item_web_url text
)
LANGUAGE sql
STABLE
AS $$
	(
		SELECT
			'rejected'::text AS bucket,
			observed_at, ebay_item_id, title, price_value, condition_label,
			rejection_reason, weapon_conflict, item_web_url
		FROM public.ebay_listing_observations
		WHERE card_id = p_card_id AND NOT accepted_by_filter
		ORDER BY observed_at DESC
		LIMIT p_rejected_limit
	)
	UNION ALL
	(
		SELECT
			'accepted'::text AS bucket,
			observed_at, ebay_item_id, title, price_value, condition_label,
			rejection_reason, weapon_conflict, item_web_url
		FROM public.ebay_listing_observations
		WHERE card_id = p_card_id AND accepted_by_filter
		ORDER BY observed_at DESC
		LIMIT p_accepted_limit
	);
$$;

-- Admin-only access. Source table is admin-only, the MV inherits the same.
ALTER MATERIALIZED VIEW public.mv_filter_health OWNER TO postgres;
REVOKE ALL ON public.mv_filter_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_filter_health TO service_role;

GRANT EXECUTE ON FUNCTION public.refresh_filter_health() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_filter_health(int, numeric, text, text, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_filter_health_samples(uuid, int, int) TO authenticated, service_role;

-- The function bodies query the MV / source table directly. Wrap with the
-- admin check inside the API route — keep the function definitions simple.

-- Initial population.
REFRESH MATERIALIZED VIEW public.mv_filter_health;
