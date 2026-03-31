-- Track when a harvest result was rejected due to low confidence
ALTER TABLE public.price_harvest_log
  ADD COLUMN IF NOT EXISTS threshold_rejected BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.price_harvest_log.threshold_rejected
  IS 'True when confidence_score was below the admin-configured threshold — price was NOT cached';
