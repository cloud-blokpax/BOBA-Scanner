-- Migration 25 — eBay per-listing observations
--
-- The price-harvest cron fetches the full eBay item summary for every card it
-- prices, then immediately discards everything except the aggregate price math.
-- This table persists the per-listing detail so it can be queried later
-- (filter regression hunting, sold-price inference, seller intelligence,
-- per-condition pricing, listing thumbnails in the War Room, etc.).
--
-- Pure write-side addition. No HTTP fetches, no sharp re-encode, no Storage
-- uploads — every column is parsed from the eBay JSON the harvester already
-- has in memory. Storage is bounded by 30-day retention (see migration 027).
--
-- High volume: ~60K rows/day at steady state. Indexes are intentionally
-- narrow — broad-coverage indexes would dominate storage.

CREATE TABLE IF NOT EXISTS public.ebay_listing_observations (
	id                       BIGSERIAL PRIMARY KEY,
	observed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
	run_id                   TEXT NOT NULL,
	card_id                  UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
	game_id                  TEXT NOT NULL DEFAULT 'boba',
	parallel                 TEXT,

	-- eBay listing identity
	ebay_item_id             TEXT NOT NULL,
	title                    TEXT NOT NULL,

	-- Price + buying option
	price_value              NUMERIC(12,2),
	price_currency           TEXT,
	bid_count                INTEGER,
	current_bid_value        NUMERIC(12,2),
	buying_options           TEXT[],

	-- Condition
	condition_label          TEXT,
	condition_id             TEXT,

	-- Seller
	seller_username          TEXT,
	seller_feedback_pct      NUMERIC(5,2),
	seller_feedback_score    INTEGER,

	-- Category + lifecycle
	category_path            TEXT,
	item_created_at          TIMESTAMPTZ,
	item_ends_at             TIMESTAMPTZ,
	priority_listing         BOOLEAN,
	marketing_original_value NUMERIC(12,2),

	-- Image + URLs
	image_url                TEXT,
	item_web_url             TEXT,
	item_affiliate_url       TEXT,

	-- Filter decision (computed in the harvester before insert)
	accepted_by_filter       BOOLEAN NOT NULL,
	rejection_reason         TEXT,
	weapon_conflict          BOOLEAN DEFAULT false,

	-- Escape hatch for fields we don't denormalize
	raw_payload              JSONB
);

CREATE INDEX IF NOT EXISTS ebay_listing_obs_card_id_idx
	ON public.ebay_listing_observations (card_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS ebay_listing_obs_run_id_idx
	ON public.ebay_listing_observations (run_id);

CREATE INDEX IF NOT EXISTS ebay_listing_obs_item_id_idx
	ON public.ebay_listing_observations (ebay_item_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS ebay_listing_obs_observed_at_idx
	ON public.ebay_listing_observations (observed_at);

CREATE INDEX IF NOT EXISTS ebay_listing_obs_seller_idx
	ON public.ebay_listing_observations (seller_username)
	WHERE seller_username IS NOT NULL;

ALTER TABLE public.ebay_listing_observations ENABLE ROW LEVEL SECURITY;

-- Admins are the only consumer in v1 (Triage / harvest-probe style queries).
DROP POLICY IF EXISTS ebay_listing_obs_admin_select ON public.ebay_listing_observations;
CREATE POLICY ebay_listing_obs_admin_select
	ON public.ebay_listing_observations
	FOR SELECT
	TO authenticated
	USING (
		EXISTS (
			SELECT 1 FROM public.users
			WHERE users.auth_user_id = auth.uid()
			  AND users.is_admin = true
		)
	);

-- Service role writes via the supabase-admin client; no INSERT/UPDATE policy
-- for authenticated users.
