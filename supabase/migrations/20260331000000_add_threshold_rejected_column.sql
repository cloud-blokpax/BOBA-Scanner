-- Add missing threshold_rejected column to price_harvest_log
-- The harvest cron writes this field but the column was missing from the original migration,
-- causing the detail query in /api/admin/harvest-log to fail silently (summary worked fine).

ALTER TABLE public.price_harvest_log
ADD COLUMN IF NOT EXISTS threshold_rejected BOOLEAN NOT NULL DEFAULT FALSE;
