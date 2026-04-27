-- Migration 26 — eBay card image dedupe table
--
-- Sibling of migration 25 (`ebay_listing_observations`) but keyed on
-- (card_id, ebay_item_id). New listings add a row; re-observed listings update
-- last_seen_at + observation_count. Storage asymptotes naturally because the
-- table is keyed on uniqueness, not on per-cycle observation.
--
-- Image URL only — no bytes are fetched. The URL is in the eBay API JSON the
-- harvester already parses. If a future session wants to download those URLs
-- into our own image cache, that's a separate CPU-budget decision under a
-- separate flag.
--
-- `is_active` flips to false via the nightly mark_stale_ebay_listings()
-- function (migration 027) when a listing hasn't been re-observed for 7 days.

CREATE TABLE IF NOT EXISTS public.ebay_card_images (
	card_id            UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
	ebay_item_id       TEXT NOT NULL,
	image_url          TEXT NOT NULL,
	thumbnail_url      TEXT,
	first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
	observation_count  INTEGER NOT NULL DEFAULT 1,
	is_active          BOOLEAN NOT NULL DEFAULT true,
	last_title         TEXT,
	parallel           TEXT,
	PRIMARY KEY (card_id, ebay_item_id)
);

CREATE INDEX IF NOT EXISTS ebay_card_images_card_id_idx
	ON public.ebay_card_images (card_id, last_seen_at DESC)
	WHERE is_active = true;

CREATE INDEX IF NOT EXISTS ebay_card_images_last_seen_idx
	ON public.ebay_card_images (last_seen_at);

ALTER TABLE public.ebay_card_images ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read active rows — this table will surface listing
-- thumbnails in the War Room / listings UI in a follow-up session.
DROP POLICY IF EXISTS ebay_card_images_authenticated_select ON public.ebay_card_images;
CREATE POLICY ebay_card_images_authenticated_select
	ON public.ebay_card_images
	FOR SELECT
	TO authenticated
	USING (is_active = true);

-- Service role writes only; no INSERT/UPDATE policy for authenticated users.
