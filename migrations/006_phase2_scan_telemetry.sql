-- Migration 6 — Phase 2 scan telemetry columns
--
-- Session 2.1a: adds the live-vs-canonical comparison telemetry and the
-- fallback-tier annotation columns to public.scans. Applied to prod via
-- Supabase MCP before the code deploy. This file is the canonical SQL so
-- fresh Supabase branches can bootstrap without re-running MCP.
--
-- Idempotent via IF NOT EXISTS clauses. Safe to re-run.

BEGIN;

-- Live OCR coordinator reached consensus before the shutter.
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS live_consensus_reached boolean;

-- Live consensus and the canonical shutter-time OCR agreed on card_number,
-- name, and (for Wonders) parallel. NULL means live didn't run at all;
-- FALSE means it ran but diverged from canonical; TRUE means match.
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS live_vs_canonical_agreed boolean;

-- Which tier eventually resolved the scan when canonical couldn't. The
-- check constraint enforces a closed vocabulary so callers don't free-text
-- new values. Any addition requires an ALTER TABLE DROP CONSTRAINT + ADD.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scans'
      AND column_name = 'fallback_tier_used'
  ) THEN
    ALTER TABLE public.scans
      ADD COLUMN fallback_tier_used text
      CHECK (fallback_tier_used IS NULL OR fallback_tier_used IN ('none','haiku','sonnet','manual'));
  END IF;
END $$;

COMMIT;
