-- Migration 13 — Backfill abandoned scans
--
-- Pre-Section-1 fix, every failure path left scans.outcome = 'pending'
-- because the success-only updateScanOutcome was the only writer. This
-- backfills rows older than 1 hour with outcome = 'abandoned' so the
-- Phase 2 outcomeDistribution dashboard converges. In-flight scans
-- (< 1 hour) are left alone in case they're still resolving.
--
-- Idempotent: WHERE outcome = 'pending' is a no-op once rows are tagged.

BEGIN;

UPDATE public.scans
SET outcome = 'abandoned'
WHERE outcome = 'pending'
  AND created_at < NOW() - INTERVAL '1 hour';

COMMIT;
