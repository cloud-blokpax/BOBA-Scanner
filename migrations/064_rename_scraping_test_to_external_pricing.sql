-- Migration 064 — Rename scraping_test → external_pricing
--
-- The table was named "scraping_test" when it was a 24-hour proof of
-- concept. It's now the live external pricing reference layer (read by
-- the sell workflow per-card) and the time-series sales archive.
-- Renaming the table + column prefix removes a permanent dev-time tax.
--
-- All renames are atomic in a single transaction. Live consumers (sell
-- view, WTP scraper, st-data API) deploy in lockstep with this migration.
--
-- Idempotent — uses ALTER ... RENAME TO IF EXISTS to handle re-runs after
-- a partial deploy.

BEGIN;

-- ── Rename the live snapshot table ───────────────────────────
ALTER TABLE IF EXISTS public.scraping_test RENAME TO external_pricing;

-- Column renames — st_* → ep_*
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_price TO ep_price;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_low TO ep_low;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_high TO ep_high;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_source_id TO ep_source_id;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_card_name TO ep_card_name;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_set_name TO ep_set_name;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_variant TO ep_variant;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_rarity TO ep_rarity;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_image_url TO ep_image_url;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_raw_data TO ep_raw_data;
ALTER TABLE IF EXISTS public.external_pricing RENAME COLUMN st_updated TO ep_updated;

-- ── Rename the time-series history table ─────────────────────
ALTER TABLE IF EXISTS public.scraping_test_history RENAME TO external_pricing_history;

-- Column renames in history table
ALTER TABLE IF EXISTS public.external_pricing_history RENAME COLUMN st_price TO ep_price;
ALTER TABLE IF EXISTS public.external_pricing_history RENAME COLUMN st_total_sales TO ep_total_sales;
ALTER TABLE IF EXISTS public.external_pricing_history RENAME COLUMN st_sales_30d TO ep_sales_30d;
ALTER TABLE IF EXISTS public.external_pricing_history RENAME COLUMN st_avg_30d TO ep_avg_30d;
ALTER TABLE IF EXISTS public.external_pricing_history RENAME COLUMN st_last_sale_date TO ep_last_sale_date;
ALTER TABLE IF EXISTS public.external_pricing_history RENAME COLUMN st_source_id TO ep_source_id;
ALTER TABLE IF EXISTS public.external_pricing_history RENAME COLUMN st_raw_data TO ep_raw_data;

-- ── Rename indexes and constraints to match ──────────────────
-- Postgres auto-renames the primary key but not other constraints/indexes.
-- We catch two patterns: names containing 'scraping_test' (table-prefixed
-- system names) and names containing 'st_' / 'st_hist' (handcrafted idx_*).

DO $$
DECLARE
  obj record;
BEGIN
  -- Indexes containing 'scraping_test'
  FOR obj IN
    SELECT i.relname AS old_name,
           replace(i.relname, 'scraping_test', 'external_pricing') AS new_name
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = 'public'
      AND i.relkind = 'i'
      AND i.relname LIKE '%scraping_test%'
  LOOP
    EXECUTE format('ALTER INDEX IF EXISTS public.%I RENAME TO %I',
                   obj.old_name, obj.new_name);
  END LOOP;

  -- Hand-named indexes idx_st_* → idx_ep_*  (and idx_st_hist_* → idx_ep_hist_*)
  FOR obj IN
    SELECT i.relname AS old_name,
           regexp_replace(i.relname, '^idx_st_', 'idx_ep_') AS new_name
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    JOIN pg_index idx ON idx.indexrelid = i.oid
    JOIN pg_class t ON t.oid = idx.indrelid
    WHERE n.nspname = 'public'
      AND i.relkind = 'i'
      AND i.relname LIKE 'idx\_st\_%' ESCAPE '\'
      AND t.relname IN ('external_pricing', 'external_pricing_history')
  LOOP
    EXECUTE format('ALTER INDEX IF EXISTS public.%I RENAME TO %I',
                   obj.old_name, obj.new_name);
  END LOOP;

  -- Constraints (unique, fkey, check) on the renamed tables
  FOR obj IN
    SELECT con.conname AS old_name,
           replace(con.conname, 'scraping_test', 'external_pricing') AS new_name,
           rel.relname AS table_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
      AND con.conname LIKE '%scraping_test%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I',
                   obj.table_name, obj.old_name, obj.new_name);
  END LOOP;
END $$;

-- ── Drop and recreate any RLS policies referencing the old name ──
-- Policy bodies/expressions don't auto-update when columns rename, but
-- usually they reference table-level things (auth.uid() etc.). Audit:

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE tablename IN ('external_pricing', 'external_pricing_history')
  LOOP
    -- If any policy text references st_* columns, abort and require manual review
    IF pol.qual LIKE '%st\_%' OR pol.with_check LIKE '%st\_%' THEN
      RAISE EXCEPTION 'RLS policy "%.%.%" references old column name (st_*) — manual rewrite required',
        pol.schemaname, pol.tablename, pol.policyname;
    END IF;
  END LOOP;
END $$;

COMMIT;
