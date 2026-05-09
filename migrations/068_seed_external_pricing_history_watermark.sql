-- Migration 068 — Seed archive_watermark for external_pricing_history.
--
-- This adds the third source table the daily R2 archive cron will export.
-- last_archived_date NULL = first cron run will export everything from
-- oldest row (~April 14, 2026) to yesterday.
--
-- See /api/cron/archive-to-r2/+server.ts SOURCE_TABLES array for the
-- corresponding code-side addition (separate code commit, same PR).
--
-- Idempotent.

INSERT INTO public.archive_watermark (app_id, source_table)
VALUES ('card-scanner', 'external_pricing_history')
ON CONFLICT (app_id, source_table) DO NOTHING;
