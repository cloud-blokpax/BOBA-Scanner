-- Phase 2 Tier 1 telemetry: add 'tier1_paddle_ocr' to the scan_tier enum so
-- consensus-builder can persist forensic per-attempt rows.
--
-- Done as its own migration: Postgres requires the new enum value to be
-- committed before it can be referenced in another DDL statement (e.g. the
-- views in tier1_telemetry_views_v1 that filter on str.tier = 'tier1_paddle_ocr').
ALTER TYPE scan_tier ADD VALUE IF NOT EXISTS 'tier1_paddle_ocr';
