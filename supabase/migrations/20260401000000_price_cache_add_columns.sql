-- Add columns that /api/price/[cardId] and the harvester write but price_cache was missing.
-- These enable buy-now-specific pricing and confidence gating on cached prices.

ALTER TABLE public.price_cache
  ADD COLUMN IF NOT EXISTS buy_now_low       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS buy_now_mid       NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS buy_now_count     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS filtered_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence_score  NUMERIC(4,2) DEFAULT 0;

-- Add threshold_rejected to harvest log (harvester writes it, column was missing)
ALTER TABLE public.price_harvest_log
  ADD COLUMN IF NOT EXISTS threshold_rejected BOOLEAN NOT NULL DEFAULT FALSE;
