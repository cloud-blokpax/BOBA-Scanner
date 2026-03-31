-- Add observability columns to ebay_api_log
ALTER TABLE public.ebay_api_log
  ADD COLUMN IF NOT EXISTS chain_depth INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cards_processed INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cards_updated INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cards_errored INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'running';

COMMENT ON COLUMN public.ebay_api_log.status IS 'running | quota_exhausted | no_cards_remaining | triggered_manual';
