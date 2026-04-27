-- Migration 23 — Harvest probe diagnostic table
--
-- Phase 1 of the price harvester investigation. Captures every input/output
-- of the existing harvester eBay path (query string, raw listings, filter
-- decisions, price math) into a dedicated diagnostic table so we can
-- review behavior on a curated ~22-card sample WITHOUT touching
-- price_cache or modifying any of the four harvester functions
-- (buildEbaySearchQuery / fetch / filterRelevantListings / calculatePriceStats).
--
-- The table is intentionally permanent infrastructure: future query/filter
-- changes should be validated through this same probe pattern. Old runs
-- can be dropped via `DELETE FROM harvest_probe WHERE created_at < now() - interval '90 days'`.
--
-- Idempotent on re-run via IF NOT EXISTS / DROP POLICY IF EXISTS.

CREATE TABLE IF NOT EXISTS public.harvest_probe (
	id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	created_at    timestamptz NOT NULL DEFAULT now(),
	run_id        uuid NOT NULL,
	card_id       uuid NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
	card_snapshot jsonb NOT NULL,
	query_string  text NOT NULL,
	query_url     text NOT NULL,
	raw_count     integer NOT NULL,
	raw_listings  jsonb NOT NULL,
	filter_decisions jsonb NOT NULL,
	filtered_count integer NOT NULL,
	price_result  jsonb,
	elapsed_ms    integer NOT NULL,
	notes         text
);

CREATE INDEX IF NOT EXISTS harvest_probe_run_id_idx ON public.harvest_probe(run_id);
CREATE INDEX IF NOT EXISTS harvest_probe_card_id_idx ON public.harvest_probe(card_id);
CREATE INDEX IF NOT EXISTS harvest_probe_created_at_idx ON public.harvest_probe(created_at DESC);

ALTER TABLE public.harvest_probe ENABLE ROW LEVEL SECURITY;

-- Admin-only access. Mirrors the pattern used by other admin diagnostic
-- tables — server-only writes go through the service-role client which
-- bypasses RLS entirely; the policies below cover read access for any
-- future direct-from-browser admin tooling.
DROP POLICY IF EXISTS harvest_probe_admin_select ON public.harvest_probe;
CREATE POLICY harvest_probe_admin_select ON public.harvest_probe
	FOR SELECT TO authenticated
	USING (
		EXISTS (
			SELECT 1 FROM public.users u
			WHERE u.auth_user_id = auth.uid() AND u.is_admin = true
		)
	);

DROP POLICY IF EXISTS harvest_probe_admin_insert ON public.harvest_probe;
CREATE POLICY harvest_probe_admin_insert ON public.harvest_probe
	FOR INSERT TO authenticated
	WITH CHECK (
		EXISTS (
			SELECT 1 FROM public.users u
			WHERE u.auth_user_id = auth.uid() AND u.is_admin = true
		)
	);

-- Verification — should return the table with 13 columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'harvest_probe'
ORDER BY ordinal_position;
